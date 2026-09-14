import { describe, it, expect } from 'vitest';
import { generateKeyPair, exportJWK, importJWK, jwtVerify, decodeProtectedHeader, decodeJwt } from 'jose';
import { buildDPoPProof, DPoPKeyPair } from './dpop';

async function makeKeyPair(): Promise<DPoPKeyPair> {
	const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
	const publicKeyJwk = await exportJWK(publicKey);
	return { privateKey, publicKeyJwk };
}

describe('buildDPoPProof', () => {
	it('produces a dpop+jwt with the ES256 public key in the jwk header', async () => {
		const keyPair = await makeKeyPair();

		const proof = await buildDPoPProof(keyPair, {
			htm: 'POST',
			htu: 'https://as.example.com/token',
		});

		const header = decodeProtectedHeader(proof);
		expect(header.typ).toBe('dpop+jwt');
		expect(header.alg).toBe('ES256');
		expect(header.jwk).toEqual(keyPair.publicKeyJwk);
	});

	it('never leaks private key material in the jwk header', async () => {
		const keyPair = await makeKeyPair();

		const proof = await buildDPoPProof(keyPair, {
			htm: 'POST',
			htu: 'https://as.example.com/token',
		});

		const header = decodeProtectedHeader(proof);
		const jwk = header.jwk as Record<string, unknown>;
		// `d` is the EC private scalar - it must never ride along in a proof.
		expect(jwk.d).toBeUndefined();
		expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
	});

	it('carries htm/htu and a fresh iat/jti in the payload', async () => {
		const keyPair = await makeKeyPair();
		const before = Math.floor(Date.now() / 1000);

		const proof = await buildDPoPProof(keyPair, {
			htm: 'GET',
			htu: 'https://issuer.example.com/credential',
		});

		const payload = decodeJwt(proof);
		const after = Math.floor(Date.now() / 1000);
		expect(payload.htm).toBe('GET');
		expect(payload.htu).toBe('https://issuer.example.com/credential');
		expect(typeof payload.jti).toBe('string');
		expect((payload.jti as string).length).toBeGreaterThan(0);
		expect(payload.iat).toBeGreaterThanOrEqual(before);
		expect(payload.iat).toBeLessThanOrEqual(after);
	});

	it('includes ath and nonce only when provided', async () => {
		const keyPair = await makeKeyPair();

		const proof = await buildDPoPProof(keyPair, {
			htm: 'GET',
			htu: 'https://issuer.example.com/credential',
			ath: 'access-token-hash',
			nonce: 'server-nonce',
		});

		const payload = decodeJwt(proof);
		expect(payload.ath).toBe('access-token-hash');
		expect(payload.nonce).toBe('server-nonce');
	});

	it('omits ath/nonce entirely when absent or empty (not ath: "")', async () => {
		const keyPair = await makeKeyPair();

		// The engine sends an empty `ath` on the token endpoint - it must not
		// surface as an `ath: ""` claim.
		const proof = await buildDPoPProof(keyPair, {
			htm: 'POST',
			htu: 'https://as.example.com/token',
			ath: '',
			nonce: '',
		});

		const payload = decodeJwt(proof);
		expect('ath' in payload).toBe(false);
		expect('nonce' in payload).toBe(false);
	});

	it('produces a proof that verifies against the embedded public key', async () => {
		const keyPair = await makeKeyPair();

		const proof = await buildDPoPProof(keyPair, {
			htm: 'POST',
			htu: 'https://as.example.com/token',
		});

		const header = decodeProtectedHeader(proof);
		const publicKey = await importJWK(header.jwk!, 'ES256');
		const { payload } = await jwtVerify(proof, publicKey);
		expect(payload.htm).toBe('POST');
	});

	it('mints a distinct jti on every call while reusing the same key (anti-replay)', async () => {
		const keyPair = await makeKeyPair();
		const params = { htm: 'POST', htu: 'https://as.example.com/token' };

		const first = await buildDPoPProof(keyPair, params);
		const second = await buildDPoPProof(keyPair, params);

		const firstPayload = decodeJwt(first);
		const secondPayload = decodeJwt(second);
		expect(firstPayload.jti).not.toBe(secondPayload.jti);

		// Same client-held key across both proofs; only the proof is fresh.
		expect(decodeProtectedHeader(first).jwk).toEqual(decodeProtectedHeader(second).jwk);
	});
});
