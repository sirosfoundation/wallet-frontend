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
 * key. `vpToken` is the string the sign handler produced. OpenID4VP 1.0 §8.1 requires
 * `vp_token` to be a JSON object with one member per Credential Query — the key the
 * query's `id`, the value an array of its presentations — so a bare (newline-separated)
 * token string is restructured into that object under `credentialQueryIds`, exactly as
 * the engine's own non-encrypted path does (go-wallet-backend's buildDCQLVPToken, which
 * direct_post.jwt bypasses by relaying this JWE verbatim). An already-object response
 * passes through. The plaintext is plain JSON claims, so no `cty` is set (RFC 7519 5.2).
 */
export async function buildJarmResponse(params: {
	vpToken: string;
	audience: string;
	state?: string;
	encryption: VerifierResponseEncryption;
	/** The DCQL Credential Query ids of the included credentials, in request order. */
	credentialQueryIds?: string[];
	now?: () => number;
}): Promise<string> {
	const { vpToken, audience, state, encryption, credentialQueryIds } = params;
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
		const parsed: unknown = JSON.parse(vpToken);
		vpTokenValue = parsed !== null && typeof parsed === 'object' ? parsed : vpToken;
	} catch {
		// Not a JSON object: the (newline-separated) token string itself.
	}
	if (typeof vpTokenValue === 'string') {
		const ids = (credentialQueryIds ?? []).filter((id) => id !== '');
		const tokens = vpTokenValue.split('\n');
		if (tokens.length !== ids.length) {
			throw new ClientHeldEncryptionError(
				`DCQL vp_token has ${tokens.length} tokens but ${ids.length} credentials selected`,
			);
		}
		// A repeated query id (`multiple: true`) collects its presentations in order,
		// mirroring the engine's own restructure.
		const byQueryId: Record<string, string[]> = {};
		ids.forEach((id, index) => {
			(byQueryId[id] ??= []).push(tokens[index]);
		});
		vpTokenValue = byQueryId;
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
