/**
 * The OID4VP `direct_post.jwt` (JARM) response, built by the wallet: the claims the verifier
 * expects as a compact JWE to the verifier's key, so the engine only relays ciphertext.
 */

import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose';
import type { JWK, KeyLike } from 'jose';
import { ClientHeldEncryptionError } from '../errors';
import { isSupportedEnc } from './algorithms';

/** JARM lifetime, seconds (same as the engine used before this moved). */
const JARM_LIFETIME_SECONDS = 300;

/** `response_encryption` as carried by a `sign_presentation` sign request (direct_post.jwt only). */
export interface VerifierResponseEncryption {
	jwk: JWK;
	alg: string;
	enc: string;
}

/**
 * The RFC 7638 SHA-256 thumbprint of the verifier's encryption key, base64url: the value the
 * mdoc session transcript binds to. Computed from the very key the response is encrypted to,
 * so the transcript and the JWE can never name different keys (as DCAPISession does).
 */
export async function verifierJwkThumbprint(jwk: JWK): Promise<string> {
	return calculateJwkThumbprint(jwk, 'sha256');
}

/**
 * Build the `direct_post.jwt` (JARM) response: the claims as a compact JWE to the verifier's
 * key. `vpToken` is the string the sign handler produced; valid JSON is parsed, so a DCQL
 * response is the `{ "<credential_query_id>": [...] }` object (what the engine used to do).
 * The plaintext is plain JSON claims, so no `cty` is set (RFC 7519 5.2).
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

	const header: { alg: string; enc: string; kid?: string } = {
		alg: encryption.alg,
		enc: encryption.enc,
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
