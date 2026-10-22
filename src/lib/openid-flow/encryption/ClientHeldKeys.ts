/**
 * Per-flow OID4VCI response-encryption keys, held by the wallet.
 *
 * The engine (go-wallet-backend) relays ciphertext only: the wallet generates the
 * credential-response encryption key and decrypts the issuer's response itself, so an
 * issued credential or a delivered seed never reaches the engine in clear.
 *
 * Nothing here logs key material, JWE plaintext, credentials or seeds, and errors carry
 * no contents.
 */

import { compactDecrypt, exportJWK, generateKeyPair } from 'jose';
import type { JWK, KeyLike } from 'jose';
import { ClientHeldEncryptionError } from '../errors';
import { isSupportedAlg, isSupportedEnc } from './algorithms';

/** The response-level `credential_metadata` member that delivers a secret seed (privatedata-spec 5A). */
const SECRET_SEED_MEMBER = 'org.siros.secret_seed';

/** Credentials per response the engine accepts as a count (go-wallet-backend contract F.5). */
const MAX_CREDENTIAL_COUNT = 256;

/** `credential_response_encryption` as carried by a `generate_proof` sign request. */
export interface CredentialResponseEncryptionRequest {
	alg: string;
	enc: string;
	required?: boolean;
}

/** A generated key: its public JWK and the generation that owns it (see {@link ClientHeldEncryptionKeys.dropGeneration}). */
export interface GeneratedResponseKey {
	jwk: JWK;
	generation: number;
}

/** What the wallet keeps from ONE decrypted Credential Response (never merged across responses). */
export interface DecryptedCredentialResponse {
	/** Credential values, in response order. */
	credentials: string[];
	/** This response's own response-level `credential_metadata`, as received. */
	credentialMetadata?: Record<string, unknown>;
	/** This response's own `notification_id`, as received. */
	notificationId?: string;
}

/**
 * The only thing the engine is told about a decrypted response: EXACTLY ONE of
 * how many credentials were issued, or the deferred transaction to poll. (An
 * error is the third shape, carried by the sign response's `error`.)
 */
export type DecryptControlFields =
	| { credentialCount: number }
	| { transactionId: string; interval?: number };

interface FlowKey {
	privateKey: KeyLike | Uint8Array;
	/** The negotiated pair: the issuer's JWE must use exactly this. */
	alg: string;
	enc: string;
	/** The latest decrypted response of this flow. */
	response?: DecryptedCredentialResponse;
}

/**
 * Each OID4VCI 1.0 section 8.3 `credentials` entry is an object with a `credential` field: the INNER value is
 * what the wallet stores (a string, or the JSON of an object credential such as `ldp_vc`). Anything else is refused.
 */
function credentialsOf(body: Record<string, unknown>): string[] {
	if (body.credentials === undefined) {
		return [];
	}
	if (!Array.isArray(body.credentials)) {
		throw new ClientHeldEncryptionError('The decrypted credential response has no credentials list');
	}
	return body.credentials.map((entry) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !('credential' in entry)) {
			throw new ClientHeldEncryptionError('The decrypted credential response has an entry without a credential');
		}
		const inner = (entry as { credential: unknown }).credential;
		if (typeof inner === 'string' && inner !== '') {
			return inner;
		}
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			return JSON.stringify(inner);
		}
		throw new ClientHeldEncryptionError('The decrypted credential response has an unusable credential');
	});
}

/**
 * Per-flow response-encryption keys, in memory only.
 *
 * A fresh key pair is made for every `generate_proof` request (a c_nonce retry sends a new
 * request and so gets a new key); the previous key of the flow is dropped at once. The
 * private key is non-extractable where the runtime honours that (WebCrypto in a browser).
 */
export class ClientHeldEncryptionKeys {
	private readonly keys = new Map<string, FlowKey>();
	/**
	 * The generation a flow's key is being (or was) made for. drop()/clear() and a newer
	 * generate() invalidate it, so a key whose generation was still pending when the flow
	 * ended (or was superseded) is never stored or returned, and a request's own cleanup
	 * cannot remove a newer request's key.
	 */
	private readonly generations = new Map<string, number>();
	private generationCounter = 0;

	/**
	 * Generate the key for a flow and return its public JWK with the owning generation, or
	 * `undefined` when the request cannot be served and was not `required`. Throws when it
	 * cannot be served and `required` is set. The flow's previous key and decrypted response
	 * are removed first, whether or not this request can be served.
	 */
	async generate(
		flowId: string,
		request: CredentialResponseEncryptionRequest,
	): Promise<GeneratedResponseKey | undefined> {
		const required = request.required === true;
		this.keys.delete(flowId);
		const generation = ++this.generationCounter;
		this.generations.set(flowId, generation);

		if (!isSupportedAlg(request.alg) || !isSupportedEnc(request.enc)) {
			if (required) {
				throw new ClientHeldEncryptionError(
					'The issuer requires credential response encryption with an algorithm this wallet does not support',
				);
			}
			return undefined;
		}
		try {
			const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', {
				crv: 'P-256',
				extractable: false,
			});
			const jwk = await exportJWK(publicKey);
			if (this.generations.get(flowId) !== generation) {
				// The flow ended, or another request took over, while the key was made.
				throw new ClientHeldEncryptionError('The flow ended while the response encryption key was being generated');
			}
			this.keys.set(flowId, { privateKey, alg: request.alg, enc: request.enc });
			return {
				jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, use: 'enc', alg: request.alg },
				generation,
			};
		} catch (err) {
			if (err instanceof ClientHeldEncryptionError) {
				throw err;
			}
			if (required) {
				throw new ClientHeldEncryptionError('Could not generate the credential response encryption key');
			}
			return undefined;
		}
	}

	has(flowId: string): boolean {
		return this.keys.has(flowId);
	}

	/**
	 * Decrypt one Credential Response JWE for a flow, remember what it carried (that response
	 * only) and return just what the engine needs. `deferred` says whether this answers a
	 * Deferred Credential request; a pending or deferred response must not deliver a seed.
	 */
	async decrypt(flowId: string, jwe: string, options: { deferred: boolean }): Promise<DecryptControlFields> {
		const entry = this.keys.get(flowId);
		if (!entry) {
			throw new ClientHeldEncryptionError('No response encryption key for this flow');
		}
		let plaintext: Uint8Array;
		try {
			({ plaintext } = await compactDecrypt(jwe, entry.privateKey, {
				// Exactly the negotiated pair, nothing else the issuer might pick.
				keyManagementAlgorithms: [entry.alg],
				contentEncryptionAlgorithms: [entry.enc],
			}));
		} catch {
			throw new ClientHeldEncryptionError('Could not decrypt the credential response');
		}

		let body: Record<string, unknown>;
		try {
			const parsed = JSON.parse(new TextDecoder().decode(plaintext));
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('not an object');
			}
			body = parsed as Record<string, unknown>;
		} catch {
			throw new ClientHeldEncryptionError('The decrypted credential response is not a JSON object');
		}

		const credentials = credentialsOf(body);
		const transactionId =
			typeof body.transaction_id === 'string' && body.transaction_id !== '' ? body.transaction_id : undefined;

		// Exactly one shape: credentials issued, or a deferred transaction to poll.
		if (transactionId !== undefined && credentials.length > 0) {
			throw new ClientHeldEncryptionError('The decrypted response carries both credentials and a transaction_id');
		}
		if (transactionId === undefined && (credentials.length < 1 || credentials.length > MAX_CREDENTIAL_COUNT)) {
			throw new ClientHeldEncryptionError('The decrypted response carries no usable number of credentials');
		}

		const metadata =
			body.credential_metadata && typeof body.credential_metadata === 'object' && !Array.isArray(body.credential_metadata)
				? (body.credential_metadata as Record<string, unknown>)
				: undefined;
		// privatedata-spec 5A.2: a seed rides only on the immediate response that issues the credentials.
		if (
			metadata &&
			Object.prototype.hasOwnProperty.call(metadata, SECRET_SEED_MEMBER) &&
			(options.deferred || transactionId !== undefined)
		) {
			throw new ClientHeldEncryptionError('A pending or deferred credential response must not deliver a secret seed');
		}

		// This response only: nothing is carried over from an earlier one.
		entry.response = {
			credentials,
			credentialMetadata: metadata,
			notificationId:
				typeof body.notification_id === 'string' && body.notification_id !== '' ? body.notification_id : undefined,
		};

		if (transactionId !== undefined) {
			return typeof body.interval === 'number' && Number.isFinite(body.interval)
				? { transactionId, interval: body.interval }
				: { transactionId };
		}
		return { credentialCount: credentials.length };
	}

	/** What the flow's latest decrypted response carried, or `undefined` before any decrypt. */
	response(flowId: string): DecryptedCredentialResponse | undefined {
		return this.keys.get(flowId)?.response;
	}

	/** Drop whatever the flow holds (its key and decrypted response, and any generation still pending). */
	drop(flowId: string): void {
		this.keys.delete(flowId);
		this.generations.delete(flowId);
	}

	/**
	 * Drop the flow's key only if `generation` still owns it: a request that failed after it
	 * generated a key must not remove a newer request's key.
	 */
	dropGeneration(flowId: string, generation: number): void {
		if (this.generations.get(flowId) === generation) {
			this.drop(flowId);
		}
	}

	clear(): void {
		this.keys.clear();
		this.generations.clear();
	}
}
