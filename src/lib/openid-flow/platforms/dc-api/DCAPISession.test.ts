import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, compactDecrypt } from 'jose';
import { DCAPISession } from './DCAPISession';
import { DCAPIWalletCompanionMode } from './modes';

// Mock the mode class
vi.mock('./modes', () => ({
	DCAPIWalletCompanionMode: vi.fn(),
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

async function createSignedJwt(payload: Record<string, unknown>, options: { alg?: string } = {}) {
	const { alg = 'ES256' } = options;
	const { privateKey, publicKey } = await generateKeyPair(alg);
	const jwk = await exportJWK(publicKey);

	const jwt = await new SignJWT(payload)
		.setProtectedHeader({ alg, typ: 'oauth-authz-req+jwt', jwk })
		.sign(privateKey);

	return { jwt, jwk, privateKey, publicKey };
}

function createMockMode() {
	return {
		originHandshake: vi.fn().mockResolvedValue('https://verifier.example.com'),
		send: vi.fn(),
		close: vi.fn(),
		verifiedOrigin: 'https://verifier.example.com',
	};
}

describe('DCAPISession', () => {
	let mockMode: ReturnType<typeof createMockMode>;

	beforeEach(() => {
		mockMode = createMockMode();
		vi.mocked(DCAPIWalletCompanionMode).mockImplementation(() => mockMode as any);
		vi.stubGlobal('opener', {}); // Just needs to be truthy for mode detection
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('parses request_id from URL', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);

			expect(session.requestId).toBe('test-request-123');
		});

		it('throws when request_id missing', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			expect(() => new DCAPISession(url)).toThrow('Missing request_id');
		});

		it('throws when no supported mode detected', () => {
			vi.stubGlobal('opener', null);

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			expect(() => new DCAPISession(url)).toThrow('Unable to detect DC API mode');
		});
	});

	describe('initialize()', () => {
		it('calls originHandshake with requestId and undefined expected_origins for unsigned request', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);
			await session.initialize();

			expect(mockMode.originHandshake).toHaveBeenCalledWith('test-request-123', undefined);
		});

		it('calls originHandshake with expected_origins for signed request', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com', 'https://alt.example.com'],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);
			await session.initialize();

			expect(mockMode.originHandshake).toHaveBeenCalledWith('test-request-123', [
				'https://verifier.example.com',
				'https://alt.example.com',
			]);
		});

		it('calls verifySignature for signed requests', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);
			const verifySpy = vi.spyOn(session.request, 'verifySignature');

			await session.initialize();

			expect(verifySpy).toHaveBeenCalled();
		});
	});

	describe('verifiedOrigin', () => {
		it('delegates to mode.verifiedOrigin', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);

			expect(session.verifiedOrigin).toBe('https://verifier.example.com');
		});
	});

	describe('verifierJwkThumbprint()', () => {
		it('returns null for dc_api mode', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));
			url.searchParams.set('response_mode', 'dc_api');

			const session = new DCAPISession(url);

			expect(await session.verifierJwkThumbprint()).toBeNull();
		});

		it('returns null when no clientMetadata', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));
			url.searchParams.set('response_mode', 'dc_api.jwt');

			const session = new DCAPISession(url);

			expect(await session.verifierJwkThumbprint()).toBeNull();
		});

		it('returns null when no enc key in jwks', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
				client_metadata: {
					jwks: { keys: [{ kty: 'EC', use: 'sig', crv: 'P-256' }] },
				},
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);

			expect(await session.verifierJwkThumbprint()).toBeNull();
		});

		it('returns SHA-256 thumbprint for enc key', async () => {
			const { publicKey } = await generateKeyPair('ECDH-ES');
			const encJwk = await exportJWK(publicKey);
			encJwk.use = 'enc';

			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
				client_metadata: { jwks: { keys: [encJwk] } },
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);

			const thumbprint = await session.verifierJwkThumbprint();
			expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
		});
	});

	describe('sendResponse()', () => {
		it('calls mode.send() with vp_token for dc_api mode', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));
			url.searchParams.set('response_mode', 'dc_api');

			const session = new DCAPISession(url);
			await session.initialize();

			const vpToken = { credential: ['token'] };
			await session.sendResponse(vpToken);

			expect(mockMode.send).toHaveBeenCalledWith({
				requestId: 'test-request-123',
				payload: { vp_token: vpToken },
			});
		});

		it('calls mode.close() after sending', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);
			await session.initialize();

			await session.sendResponse({ credential: ['token'] });

			expect(mockMode.close).toHaveBeenCalled();
		});

		it('encrypts response for dc_api.jwt mode', async () => {
			const { publicKey, privateKey } = await generateKeyPair('ECDH-ES');
			const encJwk = await exportJWK(publicKey);
			encJwk.use = 'enc';
			encJwk.kid = 'enc-key-1';

			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
				client_metadata: { jwks: { keys: [encJwk] } },
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);
			await session.initialize();

			const vpToken = { credential: ['token1'] };
			await session.sendResponse(vpToken);

			// Verify send was called with encrypted JWE
			const sendCall = mockMode.send.mock.calls[0][0];
			expect(sendCall.requestId).toBe('test-request-123');
			const jwe = sendCall.payload.response;
			expect(jwe.split('.')).toHaveLength(5);

			// Verify decryption yields original payload
			const { plaintext } = await compactDecrypt(jwe, privateKey);
			const decrypted = JSON.parse(new TextDecoder().decode(plaintext));
			expect(decrypted.vp_token).toEqual(vpToken);
		});

		it('throws when dc_api.jwt lacks client_metadata.jwks', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
				client_metadata: {},
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);
			await session.initialize();

			await expect(session.sendResponse({ credential: ['token'] })).rejects.toThrow(
				'dc_api.jwt response_mode requires client_metadata.jwks',
			);
		});

		it('throws when dc_api.jwt has no encryption key', async () => {
			const { jwt } = await createSignedJwt({
				nonce: 'test-nonce',
				dcql_query: validDcqlQuery,
				client_id: 'https://verifier.example.com',
				expected_origins: ['https://verifier.example.com'],
				response_mode: 'dc_api.jwt',
				client_metadata: {
					jwks: { keys: [{ kty: 'EC', use: 'sig', crv: 'P-256' }] },
				},
			});

			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('request', jwt);
			url.searchParams.set('client_id', 'https://verifier.example.com');

			const session = new DCAPISession(url);
			await session.initialize();

			await expect(session.sendResponse({ credential: ['token'] })).rejects.toThrow(
				'No encryption key found in client_metadata.jwks',
			);
		});
	});

	describe('sendErrorAndClose()', () => {
		it('sends user_cancelled error', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);
			await session.initialize();

			session.sendErrorAndClose('user_cancelled');

			expect(mockMode.send).toHaveBeenCalledWith({
				requestId: 'test-request-123',
				payload: { error: 'user_cancelled' },
			});
			expect(mockMode.close).toHaveBeenCalled();
		});

		it('sends access_denied error', async () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);
			await session.initialize();

			session.sendErrorAndClose('access_denied');

			expect(mockMode.send).toHaveBeenCalledWith({
				requestId: 'test-request-123',
				payload: { error: 'access_denied' },
			});
		});
	});

	describe('close()', () => {
		it('delegates to mode.close()', () => {
			const url = new URL('https://wallet.example.com/dc');
			url.searchParams.set('request_id', 'test-request-123');
			url.searchParams.set('nonce', 'test-nonce');
			url.searchParams.set('dcql_query', JSON.stringify(validDcqlQuery));

			const session = new DCAPISession(url);
			session.close();

			expect(mockMode.close).toHaveBeenCalled();
		});
	});
});
