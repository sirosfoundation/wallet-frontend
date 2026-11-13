import React, { useContext } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '@/lib/utils/createDeferred';
import SessionContext from './SessionContext';
import { SessionContextProvider } from './SessionContextProvider';
import { KeystoreEvent } from '@/services/LocalStorageKeystore';
import keystoreEvents from '@/services/keystoreEvents';

const mocks = vi.hoisted(() => ({
	api: {
		isLoggedIn: vi.fn(),
		clearSession: vi.fn(),
	},
	keystore: {
		isOpen: vi.fn(),
		close: vi.fn(),
		getCalculatedWalletState: vi.fn(() => ({ settings: {} })),
	},
	authTokens: {
		onTokenRejection: vi.fn(() => () => {}),
		onSessionExpired: vi.fn(() => () => {}),
	},
	authMaterial: { clear: vi.fn() },
}));

vi.mock('../api', () => ({ useApi: () => ({ ...mocks.api }) }));
vi.mock('../services/LocalStorageKeystore', () => ({
	SESSION_TAB_ID_KEY: 'tabId',
	useLocalStorageKeystore: () => mocks.keystore,
	KeystoreEvent: { CloseSessionTabLocal: 'keystore.closeSessionTabLocal' },
}));
vi.mock('@/lib/auth', () => ({
	AuthTokens: { fromStorage: () => mocks.authTokens },
}));
vi.mock('@/hooks/useStorage', () => ({
	useLocalStorage: () => [null],
	useSessionStorage: () => [null],
}));
vi.mock('@/hooks/useOIDFlowClientAuthStore', () => ({
	useOIDFlowClientAuthStore: () => mocks.authMaterial,
}));
vi.mock('@/hooks/useAuthServerClient', () => ({ useAuthServerClient: () => null }));
vi.mock('@/hooks/useErrorDialog', () => ({
	default: () => ({ displayError: vi.fn() }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/tenant', () => ({ getTenantFromUrlPath: () => 'default' }));
vi.mock('@/lib/utils/ohttpHelpers', () => ({ fetchKeyConfig: vi.fn() }));
vi.mock('@/config', () => ({ OHTTP_KEY_CONFIG: '' }));
vi.mock('../logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/components/Popups/SessionRecoveryPopup', () => ({
	SessionRecoveryPopup: () => null,
}));

describe('SessionContextProvider logout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.api.isLoggedIn.mockReturnValue(true);
		mocks.keystore.isOpen.mockReturnValue(true);
		mocks.keystore.close.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	const wrapper = ({ children }: React.PropsWithChildren) => (
		<SessionContextProvider>{children}</SessionContextProvider>
	);

	it.each(['before', 'during', 'after', 'without'] as const)(
		'awaits shared cleanup with a keystore event %s explicit logout',
		async (eventTiming) => {
			const deferred = createDeferred<void>();
			mocks.api.clearSession.mockReturnValue(deferred.promise);
			mocks.keystore.close.mockImplementation(async () => {
				if (eventTiming === 'during') {
					keystoreEvents.dispatchEvent(new Event(KeystoreEvent.CloseSessionTabLocal));
				}
			});
			const { result } = renderHook(() => useContext(SessionContext), { wrapper });
			const settled = vi.fn();
			let logout: Promise<void>;

			await act(async () => {
				if (eventTiming === 'before') {
					keystoreEvents.dispatchEvent(new Event(KeystoreEvent.CloseSessionTabLocal));
				}
				logout = result.current.logout().then(settled);
				await Promise.resolve();
			});

			expect(mocks.api.clearSession).toHaveBeenCalledTimes(1);
			expect(settled).not.toHaveBeenCalled();

			await act(async () => {
				deferred.resolve();
				await logout;
				if (eventTiming === 'after') {
					keystoreEvents.dispatchEvent(new Event(KeystoreEvent.CloseSessionTabLocal));
				}
			});

			expect(settled).toHaveBeenCalledOnce();
			expect(mocks.api.clearSession).toHaveBeenCalledTimes(1);
		},
	);

	it('allows cleanup again after a new login', async () => {
		mocks.api.clearSession.mockResolvedValue(undefined);
		const { result, rerender } = renderHook(() => useContext(SessionContext), { wrapper });

		await act(async () => { await result.current.logout(); });
		mocks.api.isLoggedIn.mockReturnValue(false);
		rerender();
		mocks.api.isLoggedIn.mockReturnValue(true);
		rerender();
		await act(async () => { await result.current.logout(); });

		expect(mocks.api.clearSession).toHaveBeenCalledTimes(2);
	});
});
