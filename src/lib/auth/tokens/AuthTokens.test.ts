import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthTokens } from './AuthTokens';
import { AuthServerClient } from '../auth-server/AuthServerClient';

type JwtPayload = Record<string, unknown>;

const base64UrlEncode = (obj: object): string =>
	btoa(JSON.stringify(obj))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');

const makeJwt = (overrides: JwtPayload = {}): string => {
	const payload = {
		sub: 'user-1',
		aud: 'wallet-backend',
		tenant_id: 'default',
		tac: 'rwlid',
		acr: 'urn:siros:acr:passkey',
		exp: Math.floor(Date.now() / 1000) + 3600,
		...overrides,
	};
	const header = { alg: 'ES256', kid: 'k', typ: 'JWT' };
	return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig`;
};

const tokenResponse = (jwt: string) => ({
	access_token: jwt,
	token_type: 'Bearer' as const,
	expires_in: 120,
});

/** Minimal in-memory Storage implementation. */
const createMemoryStorage = (): Storage => {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k: string) => map.get(k) ?? null,
		key: (i: number) => [...map.keys()][i] ?? null,
		removeItem: (k: string) => {
			map.delete(k);
		},
		setItem: (k: string, v: string) => {
			map.set(k, v);
		},
	};
};

const STORAGE_PREFIX = 'authToken';

describe('AuthTokens', () => {
	let client: { requestAccessToken: ReturnType<typeof vi.fn> };
	let storage: Storage;

	const makeAuthTokens = () =>
		new AuthTokens({
			authServerClient: client as unknown as AuthServerClient,
			tenantId: 'default',
			storage,
		});

	beforeEach(() => {
		client = { requestAccessToken: vi.fn() };
		storage = createMemoryStorage();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('ensureToken', () => {
		it('requests a backend token with the manifest params', async () => {
			client.requestAccessToken.mockResolvedValue(tokenResponse(makeJwt()));
			const auth = makeAuthTokens();

			const token = await auth.ensureBackendToken();

			expect(client.requestAccessToken).toHaveBeenCalledWith(
				'wallet-backend',
				'default',
				'rwlid',
				undefined,
			);
			expect(token.aud).toBe('wallet-backend');
		});

		it('requests an anonymous token for wallet-registry with anonymous=true and tac=rl', async () => {
			client.requestAccessToken.mockResolvedValue(
				tokenResponse(makeJwt({ aud: 'wallet-registry', tac: 'rl' })),
			);
			const auth = makeAuthTokens();

			await auth.ensureAnonymousToken();

			expect(client.requestAccessToken).toHaveBeenCalledWith(
				'wallet-registry',
				'default',
				'rl',
				true,
			);
		});

		it('caches a valid token and does not re-request', async () => {
			client.requestAccessToken.mockResolvedValue(tokenResponse(makeJwt()));
			const auth = makeAuthTokens();

			const first = await auth.ensureBackendToken();
			const second = await auth.ensureBackendToken();

			expect(client.requestAccessToken).toHaveBeenCalledTimes(1);
			expect(second).toBe(first);
		});

		it('persists the raw token to storage', async () => {
			const jwt = makeJwt();
			client.requestAccessToken.mockResolvedValue(tokenResponse(jwt));
			const auth = makeAuthTokens();

			await auth.ensureBackendToken();

			expect(storage.getItem(`${STORAGE_PREFIX}:backend`)).toBe(jwt);
		});

		it('re-requests when the cached token is expired', async () => {
			client.requestAccessToken
				.mockResolvedValueOnce(
					tokenResponse(makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 })),
				)
				.mockResolvedValueOnce(tokenResponse(makeJwt()));
			const auth = makeAuthTokens();

			await auth.ensureBackendToken();
			const fresh = await auth.ensureBackendToken();

			expect(client.requestAccessToken).toHaveBeenCalledTimes(2);
			expect(fresh.isExpired()).toBe(false);
		});
	});

	describe('fromStorage', () => {
		it('loads an existing token from storage without hitting the server', async () => {
			storage.setItem(`${STORAGE_PREFIX}:backend`, makeJwt());
			const auth = AuthTokens.fromStorage({
				authServerClient: client as unknown as AuthServerClient,
				tenantId: 'default',
				storage,
			});

			await auth.ensureBackendToken();

			expect(client.requestAccessToken).not.toHaveBeenCalled();
			expect(auth.backendTokenExists()).toBe(true);
		});

		it('ignores an unparseable stored token', () => {
			storage.setItem(`${STORAGE_PREFIX}:backend`, 'garbage');
			const auth = AuthTokens.fromStorage({
				authServerClient: client as unknown as AuthServerClient,
				tenantId: 'default',
				storage,
			});

			expect(auth.backendTokenExists()).toBe(false);
		});
	});

	describe('tokenExists', () => {
		it('returns false when no token is present', () => {
			expect(makeAuthTokens().backendTokenExists()).toBe(false);
		});

		it('returns true for a valid token in storage', () => {
			storage.setItem(`${STORAGE_PREFIX}:backend`, makeJwt());
			expect(makeAuthTokens().backendTokenExists()).toBe(true);
		});

		it('returns false for an expired token when checking expiration', () => {
			storage.setItem(
				`${STORAGE_PREFIX}:backend`,
				makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }),
			);
			expect(makeAuthTokens().backendTokenExists(true)).toBe(false);
		});

		it('returns true for an expired token when not checking expiration', () => {
			storage.setItem(
				`${STORAGE_PREFIX}:backend`,
				makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }),
			);
			expect(makeAuthTokens().backendTokenExists(false)).toBe(true);
		});
	});

	describe('forceRefreshToken', () => {
		it('discards a valid cached token and requests a new one', async () => {
			client.requestAccessToken
				.mockResolvedValueOnce(tokenResponse(makeJwt({ sub: 'first' })))
				.mockResolvedValueOnce(tokenResponse(makeJwt({ sub: 'second' })));
			const auth = makeAuthTokens();

			await auth.ensureBackendToken();
			const refreshed = await auth.forceRefreshBackendToken();

			expect(client.requestAccessToken).toHaveBeenCalledTimes(2);
			expect(refreshed.sub).toBe('second');
		});
	});

	describe('clear', () => {
		it('removes tokens from memory and storage', async () => {
			client.requestAccessToken.mockResolvedValue(tokenResponse(makeJwt()));
			const auth = makeAuthTokens();
			await auth.ensureBackendToken();

			await auth.clear();

			expect(storage.getItem(`${STORAGE_PREFIX}:backend`)).toBeNull();
			expect(auth.backendTokenExists()).toBe(false);
		});
	});

	describe('registerTokenRejection', () => {
		it('returns true below the threshold and false once reached', () => {
			const auth = makeAuthTokens();

			expect(auth.registerBackendTokenRejection()).toBe(true);
			expect(auth.registerBackendTokenRejection()).toBe(true);
			expect(auth.registerBackendTokenRejection()).toBe(false);
		});

		it('notifies listeners when the threshold is crossed', () => {
			const auth = makeAuthTokens();
			const listener = vi.fn();
			auth.onTokenRejection(listener);

			auth.registerBackendTokenRejection();
			auth.registerBackendTokenRejection();
			auth.registerBackendTokenRejection();

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith({ name: 'backend', rejections: 3 });
		});

		it('invalidates the cached token so a retry re-mints', async () => {
			client.requestAccessToken.mockResolvedValue(tokenResponse(makeJwt()));
			const auth = makeAuthTokens();

			await auth.ensureBackendToken();
			auth.registerBackendTokenRejection();
			await auth.ensureBackendToken();

			expect(client.requestAccessToken).toHaveBeenCalledTimes(2);
		});

		it('drops rejections that fall outside the time window', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const auth = makeAuthTokens();

			expect(auth.registerBackendTokenRejection()).toBe(true);
			expect(auth.registerBackendTokenRejection()).toBe(true);

			// Past the 60s window — earlier rejections are forgotten.
			vi.advanceTimersByTime(61 * 1000);

			expect(auth.registerBackendTokenRejection()).toBe(true);
		});

		it('stops notifying after the listener unsubscribes', () => {
			const auth = makeAuthTokens();
			const listener = vi.fn();
			const unsubscribe = auth.onTokenRejection(listener);

			unsubscribe();
			auth.registerBackendTokenRejection();
			auth.registerBackendTokenRejection();
			auth.registerBackendTokenRejection();

			expect(listener).not.toHaveBeenCalled();
		});
	});
});
