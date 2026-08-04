import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPair, exportJWK, importJWK, jwtVerify, decodeProtectedHeader } from 'jose';
import { requestWIA, buildClientAttestationPop, WIAKeyPair } from './WIA';

vi.mock('@/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

async function makeKeyPair(): Promise<WIAKeyPair> {
	const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
	const publicKeyJwk = await exportJWK(publicKey);
	return { privateKey, publicKeyJwk };
}

describe('requestWIA', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('requests a challenge, signs a matching WIA-PoP, and returns the WIA', async () => {
		const keyPair = await makeKeyPair();
		const post = vi.fn()
			.mockResolvedValueOnce({ data: { challenge: 'test-challenge', expires_at: 12345 } })
			.mockResolvedValueOnce({ data: { wallet_instance_attestation: 'signed.wia.jwt' } });

		const wia = await requestWIA(post, keyPair, 'https://wallet.example.com/redirect');

		expect(wia).toBe('signed.wia.jwt');
		expect(post).toHaveBeenNthCalledWith(1, '/wallet-provider/wia/challenge', {});

		// Second call: verify the PoP JWT is well-formed and matches what the
		// backend's validatePop actually checks (internal/service/wia.go):
		// typ header, self-signed jwk header, nonce === challenge, iss present.
		const [path, body] = post.mock.calls[1];
		expect(path).toBe('/wallet-provider/wia/generate');
		expect(body.challenge).toBe('test-challenge');
		expect(body.client_id).toBe('https://wallet.example.com/redirect');

		const header = decodeProtectedHeader(body.pop);
		expect(header.typ).toBe('oauth-client-attestation-pop+jwt');
		expect(header.alg).toBe('ES256');
		expect(header.jwk).toEqual(keyPair.publicKeyJwk);

		const verifyKey = await importJWK(keyPair.publicKeyJwk, 'ES256');
		const { payload } = await jwtVerify(body.pop, verifyKey);
		expect(payload.nonce).toBe('test-challenge');
		expect(payload.iss).toBe('https://wallet.example.com/redirect');
		expect(payload.exp).toBeDefined();
		expect(payload.jti).toBeDefined();
	});

	it('returns undefined when the challenge response is malformed', async () => {
		const keyPair = await makeKeyPair();
		const post = vi.fn().mockResolvedValueOnce({ data: {} });

		const wia = await requestWIA(post, keyPair, 'client-id');

		expect(wia).toBeUndefined();
		expect(post).toHaveBeenCalledTimes(1);
	});

	it('returns undefined when the backend does not support WIA (503) or otherwise fails', async () => {
		const keyPair = await makeKeyPair();
		const post = vi.fn().mockRejectedValueOnce({ response: { status: 503, data: { error: 'WIA_NOT_SUPPORTED' } } });

		const wia = await requestWIA(post, keyPair, 'client-id');

		expect(wia).toBeUndefined();
	});

	it('returns undefined when the generate response is malformed', async () => {
		const keyPair = await makeKeyPair();
		const post = vi.fn()
			.mockResolvedValueOnce({ data: { challenge: 'test-challenge' } })
			.mockResolvedValueOnce({ data: {} });

		const wia = await requestWIA(post, keyPair, 'client-id');

		expect(wia).toBeUndefined();
	});
});

describe('buildClientAttestationPop', () => {
	it('builds a fresh PoP JWT bound to the issuer audience, without a jwk header', async () => {
		const keyPair = await makeKeyPair();

		const pop = await buildClientAttestationPop(keyPair, 'https://wallet.example.com/redirect', 'https://issuer.example.com');

		const header = decodeProtectedHeader(pop);
		expect(header.typ).toBe('oauth-client-attestation-pop+jwt');
		expect(header.alg).toBe('ES256');
		// Unlike the WIA-PoP sent to our own backend, this PoP is verified by
		// the issuer against the WIA's own cnf key, not a self-contained jwk.
		expect(header.jwk).toBeUndefined();

		const verifyKey = await importJWK(keyPair.publicKeyJwk, 'ES256');
		const { payload } = await jwtVerify(pop, verifyKey);
		expect(payload.iss).toBe('https://wallet.example.com/redirect');
		expect(payload.aud).toBe('https://issuer.example.com');
		expect(payload.exp).toBeDefined();
		expect(payload.jti).toBeDefined();
	});

	it('produces a distinct jti on every call (anti-replay)', async () => {
		const keyPair = await makeKeyPair();

		const pop1 = await buildClientAttestationPop(keyPair, 'client-id', 'https://issuer.example.com');
		const pop2 = await buildClientAttestationPop(keyPair, 'client-id', 'https://issuer.example.com');

		const verifyKey = await importJWK(keyPair.publicKeyJwk, 'ES256');
		const { payload: p1 } = await jwtVerify(pop1, verifyKey);
		const { payload: p2 } = await jwtVerify(pop2, verifyKey);
		expect(p1.jti).not.toBe(p2.jti);
	});
});
