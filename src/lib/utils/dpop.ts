import { JWK, KeyLike, SignJWT } from 'jose';
import { generateRandomIdentifier } from '../utils/generateRandomIdentifier';

/**
 * A signing keypair for DPoP proofs.
 */
export interface DPoPKeyPair {
	privateKey: KeyLike | Uint8Array;
	publicKeyJwk: JWK;
}

/**
 * Parameters that vary per DPoP proof.
 */
export interface DPoPProofParams {
	htm: string;
	htu: string;
	ath?: string;
	nonce?: string;
}

/**
 * Build a fresh DPoP proof JWT signed by the given key.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9449.html#section-4.2
 */
export async function buildDPoPProof(
	keyPair: DPoPKeyPair,
	params: DPoPProofParams,
): Promise<string> {
	const { htm, htu, ath, nonce } = params;

	const claims: Record<string, unknown> = { htm, htu };
	if (ath) {
		claims.ath = ath;
	}
	if (nonce) {
		claims.nonce = nonce;
	}

	return await new SignJWT(claims)
		.setProtectedHeader({
			alg: 'ES256',
			typ: 'dpop+jwt',
			jwk: keyPair.publicKeyJwk,
		})
		.setIssuedAt()
		.setJti(generateRandomIdentifier(16))
		.sign(keyPair.privateKey);
}

/**
 * @deprecated - Use `buildDPoPProof` instead.
 */
export async function generateDPoP(privateKey: KeyLike, publicKeyJwk: JWK, targetMethod: string, targetUri: string, nonce?: string, access_token?: string) {
	return buildDPoPProof(
		{ privateKey, publicKeyJwk },
		{ htm: targetMethod, htu: targetUri, nonce, ath: access_token ? await calculateAth(access_token) : undefined }
	);
}

export async function calculateAth(accessToken: string) {
	// Encode the access token as a Uint8Array
	const encoder = new TextEncoder();
	const accessTokenBuffer = encoder.encode(accessToken);

	// Compute the SHA-256 hash of the access token
	const hashBuffer = await crypto.subtle.digest('SHA-256', accessTokenBuffer);

	// Convert ArrayBuffer to Base64URL string
	const base64Url = arrayBufferToBase64Url(hashBuffer);

	return base64Url;
}

function arrayBufferToBase64Url(buffer) {
	const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
	const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return base64Url;
}
