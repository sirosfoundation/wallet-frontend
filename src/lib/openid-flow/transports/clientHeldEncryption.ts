/**
 * Client-held response encryption for the engine WebSocket protocol.
 *
 * The engine (go-wallet-backend) relays ciphertext only: the wallet generates
 * the OID4VCI credential-response encryption key and decrypts the issuer's
 * response itself, and it builds the OID4VP `direct_post.jwt` (JARM) response
 * and encrypts it to the verifier's key. So an issued credential, a delivered
 * seed or a `vp_token` never reaches the engine in clear.
 *
 * Nothing in this module logs key material, JWE plaintext, credentials or
 * seeds, and errors carry no contents.
 */

import { CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK } from 'jose';
import type { JWK, KeyLike } from 'jose';

/** Key-management algorithms a client-held response key can serve (ECDH family only). */
export const RESPONSE_KEY_ALGS = ['ECDH-ES', 'ECDH-ES+A128KW', 'ECDH-ES+A256KW'] as const;

/** Content-encryption algorithms the wallet decrypts. */
export const RESPONSE_ENCS = ['A128GCM', 'A256GCM', 'A128CBC-HS256', 'A256CBC-HS512'] as const;

/** JARM lifetime, seconds (same as the engine used before this moved). */
const JARM_LIFETIME_SECONDS = 300;

/** `credential_response_encryption` as carried by a `generate_proof` sign request. */
export interface CredentialResponseEncryptionRequest {
	alg: string;
	enc: string;
	required?: boolean;
}

/** `response_encryption` as carried by a `sign_presentation` sign request (direct_post.jwt only). */
export interface VerifierResponseEncryption {
	jwk: JWK;
	alg: string;
	enc: string;
}

/** What the wallet keeps from one decrypted Credential Response. */
export interface DecryptedCredentialResponse {
	/** Credential values, in response order. */
	credentials: string[];
	/** Response-level `credential_metadata`, as received. */
	credentialMetadata?: Record<string, unknown>;
	/** Response-level `notification_id`, as received. */
	notificationId?: string;
}

/** The only fields of a decrypted response the engine is told about. */
export interface DecryptControlFields {
	transactionId?: string;
	interval?: number;
}

export class ClientHeldEncryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ClientHeldEncryptionError';
	}
}

function isSupportedAlg(alg: string): boolean {
	return (RESPONSE_KEY_ALGS as readonly string[]).includes(alg);
}

function isSupportedEnc(enc: string): boolean {
	return (RESPONSE_ENCS as readonly string[]).includes(enc);
}

/** An issuer-returned credential value as the string the wallet stores. */
function credentialToString(cred: unknown): string {
	if (typeof cred === 'string') {
		return cred;
	}
	if (cred && typeof cred === 'object' && typeof (cred as { credential?: unknown }).credential === 'string') {
		return (cred as { credential: string }).credential;
	}
	return JSON.stringify(cred);
}

interface FlowKey {
	privateKey: KeyLike | Uint8Array;
	alg: string;
	/** The latest decrypted response of this flow (a deferred answer replaces an empty first one). */
	response?: DecryptedCredentialResponse;
}

/**
 * Per-flow response-encryption keys, in memory only.
 *
 * A fresh key pair is made for every `generate_proof` request (a c_nonce retry
 * sends a new request and so gets a new key); the previous key of the flow is
 * dropped. The private key is non-extractable where the runtime honours that
 * (WebCrypto in a browser).
 */
export class ClientHeldEncryptionKeys {
	private readonly keys = new Map<string, FlowKey>();

	/**
	 * Generate the key for a flow and return its public JWK, or `undefined` when
	 * the request cannot be served and was not `required`. Throws when it
	 * cannot be served and `required` is set.
	 */
	async generate(
		flowId: string,
		request: CredentialResponseEncryptionRequest,
	): Promise<JWK | undefined> {
		const required = request.required === true;
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
			this.keys.set(flowId, { privateKey, alg: request.alg });
			return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, use: 'enc', alg: request.alg };
		} catch {
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
	 * Decrypt one Credential Response JWE for a flow, remember what it carried
	 * and return only the fields the engine needs.
	 */
	async decrypt(flowId: string, jwe: string): Promise<DecryptControlFields> {
		const entry = this.keys.get(flowId);
		if (!entry) {
			throw new ClientHeldEncryptionError('No response encryption key for this flow');
		}
		let plaintext: Uint8Array;
		try {
			({ plaintext } = await compactDecrypt(jwe, entry.privateKey, {
				keyManagementAlgorithms: [...RESPONSE_KEY_ALGS],
				contentEncryptionAlgorithms: [...RESPONSE_ENCS],
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

		const credentials: string[] = [];
		if (body.credential !== undefined && body.credential !== null) {
			credentials.push(credentialToString(body.credential));
		}
		if (Array.isArray(body.credentials)) {
			for (const c of body.credentials) {
				credentials.push(credentialToString(c));
			}
		}

		const previous = entry.response;
		const metadata = body.credential_metadata;
		entry.response = {
			credentials: credentials.length > 0 ? credentials : previous?.credentials ?? [],
			credentialMetadata:
				metadata && typeof metadata === 'object' && !Array.isArray(metadata)
					? (metadata as Record<string, unknown>)
					: previous?.credentialMetadata,
			notificationId:
				typeof body.notification_id === 'string' && body.notification_id !== ''
					? body.notification_id
					: previous?.notificationId,
		};

		const control: DecryptControlFields = {};
		if (typeof body.transaction_id === 'string' && body.transaction_id !== '') {
			control.transactionId = body.transaction_id;
		}
		if (typeof body.interval === 'number' && Number.isFinite(body.interval)) {
			control.interval = body.interval;
		}
		return control;
	}

	/** What the flow's decrypted responses carried, or `undefined` before any decrypt. */
	response(flowId: string): DecryptedCredentialResponse | undefined {
		return this.keys.get(flowId)?.response;
	}

	drop(flowId: string): void {
		this.keys.delete(flowId);
	}

	clear(): void {
		this.keys.clear();
	}
}

/**
 * Build the `direct_post.jwt` (JARM) response: the claims the verifier expects,
 * as a compact JWE to the verifier's key. `vpToken` is the string the sign
 * handler produced; valid JSON is parsed, so a DCQL response is the
 * `{ "<credential_query_id>": [...] }` object (what the engine used to do).
 */
export async function buildJarmResponse(params: {
	vpToken: string;
	audience: string;
	state?: string;
	encryption: VerifierResponseEncryption;
	now?: () => number;
}): Promise<string> {
	const { vpToken, audience, state, encryption } = params;
	if (!encryption?.jwk || !isSupportedEnc(encryption.enc) || typeof encryption.alg !== 'string' || encryption.alg === '') {
		throw new ClientHeldEncryptionError('The verifier response encryption parameters are unusable');
	}
	if (!audience) {
		throw new ClientHeldEncryptionError('The verified request has no client_id to use as audience');
	}

	let vpTokenValue: unknown = vpToken;
	try {
		vpTokenValue = JSON.parse(vpToken);
	} catch {
		// Not JSON: the token string itself.
	}

	const iat = Math.floor((params.now ?? Date.now)() / 1000);
	const claims: Record<string, unknown> = {
		iss: 'https://self-issued.me/v2',
		aud: audience,
		iat,
		exp: iat + JARM_LIFETIME_SECONDS,
		vp_token: vpTokenValue,
	};
	if (state) {
		claims.state = state;
	}

	let key: KeyLike | Uint8Array;
	try {
		key = await importJWK(encryption.jwk, encryption.alg);
	} catch {
		throw new ClientHeldEncryptionError('The verifier response encryption key is unusable');
	}

	const header: { alg: string; enc: string; cty: string; kid?: string } = {
		alg: encryption.alg,
		enc: encryption.enc,
		cty: 'JWT',
	};
	if (typeof encryption.jwk.kid === 'string' && encryption.jwk.kid !== '') {
		header.kid = encryption.jwk.kid;
	}

	try {
		return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(claims)))
			.setProtectedHeader(header)
			.encrypt(key);
	} catch {
		throw new ClientHeldEncryptionError('Could not encrypt the presentation response');
	}
}
