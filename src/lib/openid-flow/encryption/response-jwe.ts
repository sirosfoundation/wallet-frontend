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
 * Restructure a sign handler's `vp_token` into the OpenID4VP 1.0 §8.3.1 object
 * form: a JSON object with one member per Credential Query — the key the
 * query's `id`, the value an array of that query's presentations. A handler
 * that already returned a JSON object passes through as is; anything else is
 * newline-separated tokens, exactly one per included credential (the count
 * must match), a repeated query id collecting in order — mirroring the
 * engine's own builder (go-wallet-backend's `buildDCQLVPToken`), which the
 * client-held encryption paths bypass.
 */
export function restructureDcqlVpToken(
	vpToken: string,
	credentialQueryIds: string[],
): Record<string, string[]> {
	// A JSON-quoted single token parses to the token string itself.
	let parsed: unknown;
	try {
		parsed = JSON.parse(vpToken);
	} catch {
		parsed = undefined;
	}
	if (parsed !== null && parsed !== undefined && typeof parsed === 'object' && !Array.isArray(parsed)) {
		return parsed as Record<string, string[]>;
	}
	const raw = typeof parsed === 'string' ? parsed : vpToken;
	const ids = credentialQueryIds.filter((id) => id !== '');
	const tokens = raw.split('\n');
	if (tokens.length !== ids.length) {
		throw new ClientHeldEncryptionError(
			`DCQL vp_token has ${tokens.length} tokens but ${ids.length} credentials selected`,
		);
	}
	const byQueryId: Record<string, string[]> = {};
	ids.forEach((id, index) => {
		(byQueryId[id] ??= []).push(tokens[index]);
	});
	return byQueryId;
}

/**
 * Build the `direct_post.jwt` (JARM) response: the claims as a compact JWE to the verifier's
 * key. `vpToken` is the string the sign handler produced. OpenID4VP 1.0 §8.3.1 requires
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

	const vpTokenValue = restructureDcqlVpToken(vpToken, credentialQueryIds ?? []);

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
