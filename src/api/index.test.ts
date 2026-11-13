import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { AuthTokens } from '@/lib/auth';
import { AuthServerClient } from '@/lib/auth/auth-server/AuthServerClient';
import { useSessionStorage } from '@/hooks/useStorage';
import { createDeferred } from '@/lib/utils/createDeferred';
import { useApi } from './index';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuthServerClient', () => ({
	useAuthServerClient: () => new AuthServerClient({ baseUrl: 'https://backend.example.com' }),
}));
vi.mock('../services/keystore', () => ({}));
vi.mock('./LocalAuthentication', () => ({ loginWebAuthnBeginOffline: vi.fn() }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));

describe('clearSession', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		sessionStorage.setItem('sessionState', JSON.stringify({ uuid: 'u-1' }));
		localStorage.setItem('privateDataEtag', JSON.stringify('etag-1'));
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.useRealTimers();
		sessionStorage.clear();
		localStorage.clear();
	});

	it.each(['success', 'failure'] as const)(
		'clears registered storage before listeners unmount during pending logout (%s)',
		async (outcome) => {
			const deferred = createDeferred<void>();
			vi.spyOn(AuthServerClient.prototype, 'logout').mockReturnValue(deferred.promise);
			const clear = vi.fn();
			const authTokens = { clear } as unknown as AuthTokens;
			const { result } = renderHook(() => useApi({ isOnline: true, authTokens }));
			sessionStorage.setItem('isMessageOfflineVisible', JSON.stringify(true));
			const listener = renderHook(() =>
				result.current.useClearOnClearSession(useSessionStorage('isMessageOfflineVisible', false)),
			);
			expect(listener.result.current[0]).toBe(true);

			let logout: Promise<void>;
			act(() => {
				logout = result.current.clearSession();
			});

			expect(sessionStorage.getItem('isMessageOfflineVisible')).toBeNull();
			expect(listener.result.current[0]).toBe(false);
			expect(clear).not.toHaveBeenCalled();
			listener.unmount();

			await act(async () => {
				if (outcome === 'success') {
					deferred.resolve();
				} else {
					deferred.reject(new Error('Logout failed'));
				}
				await logout;
			});

			expect(clear).toHaveBeenCalledOnce();
			expect(sessionStorage.getItem('sessionState')).toBeNull();
			expect(sessionStorage.getItem('isMessageOfflineVisible')).toBeNull();
		},
	);

	it('clears local session state and tokens after cancelling a stalled logout', async () => {
		const request = vi.spyOn(axios, 'request').mockImplementation(({ signal }) => new Promise((_, reject) => {
			signal!.addEventListener!('abort', () => reject(new Error('Request aborted')));
		}));
		const clear = vi.fn();
		const authTokens = { clear } as unknown as AuthTokens;
		const { result } = renderHook(() => useApi({ isOnline: true, authTokens }));
		expect(result.current.isLoggedIn()).toBe(true);

		const settled = vi.fn();
		let logout: Promise<void>;
		await act(async () => {
			logout = result.current.clearSession().then(settled);
			await vi.advanceTimersByTimeAsync(4999);
		});
		expect(clear).not.toHaveBeenCalled();
		expect(settled).not.toHaveBeenCalled();
		expect(sessionStorage.getItem('sessionState')).not.toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await logout;
		});

		expect(request.mock.calls[0][0]?.signal?.aborted).toBe(true);
		expect(clear).toHaveBeenCalledOnce();
		expect(settled).toHaveBeenCalledOnce();
		expect(sessionStorage.getItem('sessionState')).toBeNull();
		expect(localStorage.getItem('privateDataEtag')).toBeNull();
		expect(result.current.isLoggedIn()).toBe(false);
	});
});
