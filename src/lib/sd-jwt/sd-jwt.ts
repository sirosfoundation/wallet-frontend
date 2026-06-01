import { SDJwt } from '@sd-jwt/core';
import * as jose from 'jose';
import { fromPemToPKIJSCertificate, toPem, validateChain, getPublicKeyFromB64Cert } from '../utils/pki';
import { logger } from '@/logger';

export async function verifySdJwtBasedOnTrustAnchors(credential: string) {
	let cred = credential.split('~')[0];

	const { x5c } = JSON.parse(new TextDecoder().decode(jose.base64url.decode(cred.split('.')[0])))
	const chain = x5c.map((c) => {
		const cert = fromPemToPKIJSCertificate(toPem(c));
		return cert;
	});

	const chainValidation = await validateChain(chain, []);
	if (!chainValidation) {
		return false;
	}

	const publicKey = await jose.importX509(getPublicKeyFromB64Cert(x5c[0]), 'ES256');
	try {
		await jose.jwtVerify(cred, publicKey);
		return true;
	} catch (err) {
		logger.error('JWT verification failed:', err);
		return false;
	}
}

/**
 * Applies SD-JWT selective disclosure so only the requested claims are revealed.
 *
 * An SD-JWT contains tilde-separated disclosure segments: `<jwt>~<d1>~<d2>~...~`
 * Each disclosure reveals one claim. This function strips out disclosures for
 * claims the verifier didn't ask for, so only the requested ones remain.
 *
 * @param rawCredential - Full SD-JWT string with all disclosures
 * @param requestedClaims - Dot-separated claim paths, e.g. ["email", "address.street"]
 * @returns SD-JWT string with only the requested disclosures
 */
export async function applySelectiveDisclosure(rawCredential: string, requestedClaims: string[]): Promise<string> {
	const hasDisclosures = rawCredential.split('~').length - 1 > 1;
	if (!hasDisclosures) {
		return rawCredential;
	}

	const sdJwt = await SDJwt.fromEncode(rawCredential, sha256Hasher);
	const presentationFrame = claimPathsToFrame(requestedClaims);
	return sdJwt.present(presentationFrame, sha256Hasher);
}

/**
 * Converts dot-separated claim paths into the nested frame object that
 * @sd-jwt/core expects for selective disclosure.
 *
 * Example:
 *   ["email", "address.street"]
 *   → { email: true, address: { street: true } }
 *
 * A value of `true` means "disclose this claim".
 * A nested object means "descend into this group".
 */
function claimPathsToFrame(claimPaths: string[]): Record<string, unknown> {
	const frame: Record<string, unknown> = {};

	for (const path of claimPaths) {
		const segments = path.split('.');
		let node: Record<string, unknown> = frame;

		for (let i = 0; i < segments.length; i++) {
			const isLeaf = i === segments.length - 1;
			if (isLeaf) {
				node[segments[i]] = true;
			} else {
				node[segments[i]] = node[segments[i]] || {};
				node = node[segments[i]] as Record<string, unknown>;
			}
		}
	}

	return frame;
}

/** SHA-256 hasher compatible with @sd-jwt/core */
async function sha256Hasher(data: string | ArrayBuffer, alg: string): Promise<Uint8Array> {
	const bytes = typeof data === 'string'
		? new TextEncoder().encode(data)
		: new Uint8Array(data);
	return new Uint8Array(await crypto.subtle.digest(alg, bytes));
}
