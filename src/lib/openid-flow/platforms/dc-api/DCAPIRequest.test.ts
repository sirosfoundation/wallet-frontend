import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, importJWK } from 'jose';
import * as x509 from '@peculiar/x509';
import { DCAPIRequest } from './DCAPIRequest';
import { logger } from '@/logger';

// Mock logger to test warning paths
vi.mock('@/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Valid DCQL query for tests
const validDcqlQuery = {
	credentials: [
		{
			id: 'test-credential',
			format: 'dc+sd-jwt',
			meta: { vct_values: ['https://example.com/credential'] },
		},
	],
};

describe('DCAPIRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('unsigned request parsing', () => {
		it('parses valid unsigned request with nonce and dcql_query', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const request = new DCAPIRequest(url);

			expect(request.isSigned).toBe(false);
			expect(request.nonce).toBe('test-nonce');
			expect(request.dcqlQuery).toEqual(validDcqlQuery);
			expect(request.responseMode).toBe('dc_api');
		});

		it('throws on missing nonce in unsigned request', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			expect(() => new DCAPIRequest(url)).toThrow('Invalid DC API request parameters');
		});

		it('throws on invalid dcql_query JSON', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', 'not-valid-json');

			expect(() => new DCAPIRequest(url)).toThrow('Invalid JSON in dcql_query parameter');
		});

		it('throws on missing dcql_query', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');

			expect(() => new DCAPIRequest(url)).toThrow('Invalid dcql_query');
		});

		it('parses response_mode correctly', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));
			url.searchParams.set('response_mode', 'dc_api.jwt');

			const request = new DCAPIRequest(url);

			expect(request.responseMode).toBe('dc_api.jwt');
		});
	});

	describe('signed request parsing', () => {
		it('parses valid signed JWT request', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api',
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.isSigned).toBe(true);
			expect(request.nonce).toBe('test-nonce');
			expect(request.clientId).toBe('https://verifier.example.com');
			expect(request.expectedOrigins).toEqual(['https://verifier.example.com']);
		});

		it('throws when JWT typ header is not oauth-authz-req+jwt', async () => {
			const { jwt } = await createSignedJwt(
				{
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				},
				{ typ: 'JWT' },
			);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			expect(() => new DCAPIRequest(url)).toThrow(
				"Invalid JWT payload type, must be 'oauth-authz-req+jwt'",
			);
		});

		it('throws when expected_origins is empty array', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: [],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			expect(() => new DCAPIRequest(url)).toThrow('expected_origins cannot be empty');
		});

		it('throws when JWT header has no key material (no jwk, x5c, or kid)', async () => {
			const { jwt } = await createSignedJwt(
				{
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				},
				{ noKeyMaterial: true },
			);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			expect(() => new DCAPIRequest(url)).toThrow('JWT header must contain jwk, x5c, or kid');
		});

		it('throws on malformed JWT (not 3 parts)', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', 'not.a.valid.jwt.format');
			url.searchParams.set('client_id', 'https://verifier.example.com');

			expect(() => new DCAPIRequest(url)).toThrow();
		});

		it('throws on malformed JWT (single part)', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', 'singlepart');
			url.searchParams.set('client_id', 'https://verifier.example.com');

			expect(() => new DCAPIRequest(url)).toThrow();
		});

		it('parses client_metadata when present', async () => {
			const clientMetadata = {
				jwks: {
					keys: [{ kty: 'EC', use: 'enc', crv: 'P-256' }],
				},
			};

			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				client_metadata: clientMetadata,
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.clientMetadata).toEqual(clientMetadata);
		});

		it('logs warning when iss claim is present', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				iss: 'https://issuer.example.com',
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			void new DCAPIRequest(url);

			expect(logger.warn).toHaveBeenCalledWith(
				"JWT 'iss' claim is not supported and will be ignored",
			);
		});
	});

	describe('key material extraction', () => {
		it('extracts jwk key material from JWT header', async () => {
			const { jwt, jwk } = await createSignedJwt(
				{
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				},
				{ includeJwk: true },
			);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.keyMaterial?.type).toBe('jwk');
			expect(request.keyMaterial?.value).toEqual(jwk);
		});

		it('extracts kid key material from JWT header', async () => {
			const { jwt } = await createSignedJwt(
				{
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				},
				{ includeJwk: false, includeKid: true },
			);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.keyMaterial?.type).toBe('kid');
			expect(request.keyMaterial?.value).toBe('test-key-id');
		});

		it('extracts x5c key material from JWT header', async () => {
			const { jwt, certBase64 } = await createX5cSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.keyMaterial?.type).toBe('x5c');
			expect(request.keyMaterial?.value).toEqual([certBase64]);
		});
	});

	describe('signature verification', () => {
		it('verifies valid signature with JWK', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).resolves.toBeUndefined();
		});

		it('verifies valid signature with x5c', async () => {
			const { jwt } = await createX5cSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).resolves.toBeUndefined();
		});

		it('skips verification for kid-only key material', async () => {
			const { jwt } = await createSignedJwt(
				{
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				},
				{ includeJwk: false, includeKid: true },
			);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).resolves.toBeUndefined();
		});

		it('does nothing for unsigned requests', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).resolves.toBeUndefined();
		});

		it('throws on invalid JWT signature', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
			});

			const parts = jwt.split('.');
			parts[2] = parts[2].slice(0, -5) + 'XXXXX';
			const tamperedJwt = parts.join('.');

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', tamperedJwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).rejects.toThrow('JWT signature verification failed');
		});

		it('throws on unsupported algorithm', async () => {
			// Create a JWT with an unsupported algorithm in the header
			// We'll manually construct a JWT with 'none' algorithm
			const header = btoa(JSON.stringify({ alg: 'none', typ: 'oauth-authz-req+jwt', kid: 'test' }));
			const payload = btoa(
				JSON.stringify({
					nonce: 'test-nonce',
					dcql_query: validDcqlQuery,
					client_id: 'https://verifier.example.com',
					expected_origins: ['https://verifier.example.com'],
				}),
			);
			const jwt = `${header}.${payload}.`;

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			await expect(request.verifySignature()).rejects.toThrow('Unsupported JWT algorithm: none');
		});
	});

	describe('getters', () => {
		it('returns correct values for signed request', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const request = new DCAPIRequest(url);

			expect(request.nonce).toBe('test-nonce');
			expect(request.dcqlQuery).toEqual(validDcqlQuery);
			expect(request.responseMode).toBe('dc_api.jwt');
			expect(request.clientId).toBe('https://verifier.example.com');
			expect(request.expectedOrigins).toEqual(['https://verifier.example.com']);
			expect(request.keyMaterial).toBeDefined();
		});

		it('returns undefined for unsigned request properties', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const request = new DCAPIRequest(url);

			expect(request.clientId).toBeUndefined();
			expect(request.expectedOrigins).toBeUndefined();
			expect(request.clientMetadata).toBeUndefined();
			expect(request.keyMaterial).toBeUndefined();
		});
	});
});

async function createSignedJwt(
	payload: Record<string, unknown>,
	options: {
		typ?: string;
		includeJwk?: boolean;
		includeX5c?: boolean;
		includeKid?: boolean;
		alg?: string;
		noKeyMaterial?: boolean;
	} = {},
) {
	const { typ = 'oauth-authz-req+jwt', includeJwk = true, alg = 'ES256' } = options;
	const { privateKey, publicKey } = await generateKeyPair(alg);
	const jwk = await exportJWK(publicKey);

	const headerOptions: Record<string, unknown> = { alg, typ };

	if (!options.noKeyMaterial) {
		if (includeJwk) headerOptions.jwk = jwk;
		if (options.includeKid) headerOptions.kid = 'test-key-id';
	}

	const builder = new SignJWT(payload).setProtectedHeader(headerOptions as any);

	return {
		jwt: await builder.sign(privateKey),
		jwk,
		privateKey,
		publicKey,
	};
}

async function createX5cSignedJwt(payload: Record<string, unknown>) {
	const alg = 'ES256';

	const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify',
	]);

	const cert = await x509.X509CertificateGenerator.createSelfSigned({
		serialNumber: '01',
		name: 'CN=Test',
		notBefore: new Date(),
		notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
		keys,
		signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
	});

	const certBase64 = cert.toString('base64');

	const josePrivateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
	const signingKey = await importJWK(josePrivateKey as any, alg);

	const jwt = await new SignJWT(payload)
		.setProtectedHeader({ alg, typ: 'oauth-authz-req+jwt', x5c: [certBase64] })
		.sign(signingKey);

	return { jwt, certBase64, keys };
}
