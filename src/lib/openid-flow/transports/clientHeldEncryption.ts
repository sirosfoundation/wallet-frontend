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

/**
 * The only thing the engine is told about a decrypted response: EXACTLY ONE of
 * how many credentials were issued, or the deferred transaction to poll. (An
 * error is the third shape, carried by the sign response's `error`.)
 */
export type DecryptControlFields =
	| { credentialCount: number }
	| { transactionId: string; interval?: number };

/** Credentials per response the engine accepts as a count (go-wallet-backend contract F.5). */
const MAX_CREDENTIAL_COUNT = 256;

/** The JWE size ceiling the engine enforces on a presentation response. */
const MAX_JWE_BYTES = 4 * 1024 * 1024;

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
	/** The negotiated pair: the issuer's JWE must use exactly this. */
	alg: string;
	enc: string;
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
			this.keys.set(flowId, { privateKey, alg: request.alg, enc: request.enc });
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

		const credentials: string[] = [];
		if (body.credential !== undefined && body.credential !== null) {
			credentials.push(credentialToString(body.credential));
		}
		if (Array.isArray(body.credentials)) {
			for (const c of body.credentials) {
				credentials.push(credentialToString(c));
			}
		}

		const transactionId =
			typeof body.transaction_id === 'string' && body.transaction_id !== '' ? body.transaction_id : undefined;

		// Exactly one shape: credentials issued, or a deferred transaction to poll.
		if (transactionId !== undefined && credentials.length > 0) {
			throw new ClientHeldEncryptionError('The decrypted response carries both credentials and a transaction_id');
		}
		if (transactionId === undefined && (credentials.length < 1 || credentials.length > MAX_CREDENTIAL_COUNT)) {
			throw new ClientHeldEncryptionError('The decrypted response carries no usable number of credentials');
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

		if (transactionId !== undefined) {
			return typeof body.interval === 'number' && Number.isFinite(body.interval)
				? { transactionId, interval: body.interval }
				: { transactionId };
		}
		return { credentialCount: credentials.length };
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
	if ('d' in encryption.jwk) {
		// A private JWK is never a recipient; the engine refuses it too.
		throw new ClientHeldEncryptionError('The verifier response encryption key must be a public key');
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

	let jwe: string;
	try {
		jwe = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(claims)))
			.setProtectedHeader(header)
			.encrypt(key);
	} catch {
		throw new ClientHeldEncryptionError('Could not encrypt the presentation response');
	}
	assertEngineAcceptableJwe(jwe, { alg: encryption.alg, enc: encryption.enc, kid: header.kid });
	return jwe;
}

function decodeSegment(segment: string): string | undefined {
	try {
		return atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
	} catch {
		return undefined;
	}
}

/**
 * The checks the engine applies to a `response_jwe` before it posts it
 * (go-wallet-backend contract G), run here so a response it would refuse is
 * never sent: at most 4 MiB; five base64url segments, none empty (the
 * encrypted-key segment may be empty only for direct ECDH-ES); the protected
 * header's `alg`/`enc` equal the request's, and its `kid` equals the JWK's
 * when the JWK has one.
 */
export function assertEngineAcceptableJwe(
	jwe: string,
	expected: { alg: string; enc: string; kid?: string },
): void {
	if (jwe.length === 0 || jwe.length > MAX_JWE_BYTES) {
		throw new ClientHeldEncryptionError('The presentation response is empty or too large');
	}
	const segments = jwe.split('.');
	if (segments.length !== 5 || !segments.every((seg) => /^[A-Za-z0-9_-]*$/.test(seg))) {
		throw new ClientHeldEncryptionError('The presentation response is not a compact JWE');
	}
	segments.forEach((seg, i) => {
		const mayBeEmpty = i === 1 && expected.alg === 'ECDH-ES';
		if (seg === '' && !mayBeEmpty) {
			throw new ClientHeldEncryptionError('The presentation response has an empty JWE segment');
		}
	});
	let header: { alg?: unknown; enc?: unknown; kid?: unknown };
	try {
		header = JSON.parse(decodeSegment(segments[0]) ?? '');
	} catch {
		throw new ClientHeldEncryptionError('The presentation response has an unreadable JWE header');
	}
	if (header.alg !== expected.alg || header.enc !== expected.enc) {
		throw new ClientHeldEncryptionError('The presentation response header does not match the requested algorithms');
	}
	if (expected.kid !== undefined && header.kid !== expected.kid) {
		throw new ClientHeldEncryptionError('The presentation response header kid does not match the verifier key');
	}
}
