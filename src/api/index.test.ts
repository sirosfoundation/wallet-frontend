import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { AuthTokens } from '@/lib/auth';
import { AuthServerClient } from '@/lib/auth/auth-server/AuthServerClient';
import { useApi } from './index';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuthServerClient', () => ({
	useAuthServerClient: () => new AuthServerClient({ baseUrl: 'https://backend.example.com' }),
}));
vi.mock('../services/keystore', () => ({}));
vi.mock('./LocalAuthentication', () => ({ loginWebAuthnBeginOffline: vi.fn() }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));

describe('clearSession logout deadline', () => {
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
