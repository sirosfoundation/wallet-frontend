import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import StatusContext from './StatusContext';
import { SessionContextProvider } from './SessionContextProvider';

// vi.mock factories are hoisted above the imports, so anything they share with
// the tests has to be hoisted too.
const {
	authTokensStub,
	apiStub,
	keystoreStub,
	displayError,
	clientAuthStore,
	sessionExpiredListeners,
	tokenRejectionListeners,
} = vi.hoisted(() => {
	const sessionExpiredListeners: (() => Promise<void>)[] = [];
	const tokenRejectionListeners: (() => void)[] = [];

	return {
		sessionExpiredListeners,
		tokenRejectionListeners,
		authTokensStub: {
			onSessionExpired: (listener: () => Promise<void>) => {
				sessionExpiredListeners.push(listener);
				return () => {
					const i = sessionExpiredListeners.indexOf(listener);
					if (i >= 0) sessionExpiredListeners.splice(i, 1);
				};
			},
			onTokenRejection: (listener: () => void) => {
				tokenRejectionListeners.push(listener);
				return () => {
					const i = tokenRejectionListeners.indexOf(listener);
					if (i >= 0) tokenRejectionListeners.splice(i, 1);
				};
			},
		},
		// isLoggedIn stays false so the provider renders its children rather than
		// the empty placeholder it shows while a logged-in wallet is still opening.
		apiStub: { isLoggedIn: () => false, clearSession: vi.fn() },
		keystoreStub: {
			isOpen: () => false,
			close: vi.fn(async () => {}),
			getCalculatedWalletState: () => null,
		},
		displayError: vi.fn(),
		clientAuthStore: { clear: vi.fn() },
	};
});

vi.mock('@/hooks/useAuthServerClient', () => ({ useAuthServerClient: () => ({}) }));
vi.mock('@/lib/tenant', () => ({ getTenantFromUrlPath: () => 'default' }));
vi.mock('@/lib/auth', () => ({ AuthTokens: { fromStorage: () => authTokensStub } }));
vi.mock('../api', () => ({ useApi: () => apiStub }));
vi.mock('../services/LocalStorageKeystore', () => ({
	useLocalStorageKeystore: () => keystoreStub,
	KeystoreEvent: { CloseSessionTabLocal: 'CloseSessionTabLocal' },
}));
vi.mock('../services/keystoreEvents', () => ({
	default: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
}));
vi.mock('@/hooks/useStorage', () => ({
	useLocalStorage: () => [null, vi.fn()],
	useSessionStorage: () => [null, vi.fn()],
}));
vi.mock('@/hooks/useErrorDialog', () => ({ default: () => ({ displayError }) }));
vi.mock('@/hooks/useOIDFlowClientAuthStore', () => ({
	useOIDFlowClientAuthStore: () => clientAuthStore,
}));
vi.mock('@/lib/utils/ohttpHelpers', () => ({ fetchKeyConfig: vi.fn(async () => null) }));
vi.mock('../logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// A stand-in for the real popup, exposing the three things the provider wires into
// it so a test can drive recovery the way a user would.
vi.mock('@/components/Popups/SessionRecoveryPopup', async () => {
	const ReactModule = await import('react');
	return {
		SessionRecoveryPopup: ({ recovery, onLogout }: {
			recovery: { resolve: () => void; reject: (reason?: unknown) => void };
			onLogout: () => void;
		}) => ReactModule.createElement('div', { 'data-testid': 'session-recovery-popup' },
			ReactModule.createElement('button', { onClick: () => recovery.resolve() }, 'recover'),
			ReactModule.createElement('button', { onClick: () => recovery.reject(new Error('declined')) }, 'decline'),
			ReactModule.createElement('button', { onClick: onLogout }, 'logout'),
		),
	};
});

const renderProvider = () => render(
	<StatusContext.Provider value={{ isOnline: true } as never}>
		<SessionContextProvider>
			<div>app</div>
		</SessionContextProvider>
	</StatusContext.Provider>,
);

/** The session-expiry listener the provider registered with AuthTokens. */
const expireSession = () => {
	const listener = sessionExpiredListeners[sessionExpiredListeners.length - 1];
	if (!listener) throw new Error('provider registered no session-expiry listener');
	return listener;
};

describe('SessionContextProvider session recovery', () => {
	beforeEach(() => {
		sessionExpiredListeners.length = 0;
		tokenRejectionListeners.length = 0;
		displayError.mockClear();
		apiStub.clearSession.mockClear();
		clientAuthStore.clear.mockClear();
	});

	it('prompts for recovery when the session expires', async () => {
		renderProvider();
		expect(screen.queryByTestId('session-recovery-popup')).not.toBeInTheDocument();

		let pending: Promise<void>;
		act(() => { pending = expireSession()(); });
		pending!.catch(() => {});

		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());
	});

	// A second expiry while the user is still looking at the prompt must join the
	// recovery already in flight rather than stacking a second one.
	it('returns the in-flight promise instead of prompting twice', async () => {
		renderProvider();

		let first: Promise<void>;
		let second: Promise<void>;
		act(() => { first = expireSession()(); });
		act(() => { second = expireSession()(); });
		first!.catch(() => {});

		expect(second!).toBe(first!);
		await waitFor(() => expect(screen.getAllByTestId('session-recovery-popup')).toHaveLength(1));
	});

	it('resolves the waiting caller and dismisses the prompt once recovered', async () => {
		renderProvider();

		let pending: Promise<void>;
		act(() => { pending = expireSession()(); });
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());

		let settled = false;
		pending!.then(() => { settled = true; });
		act(() => { screen.getByText('recover').click(); });

		await waitFor(() => expect(settled).toBe(true));
		await waitFor(() => expect(screen.queryByTestId('session-recovery-popup')).not.toBeInTheDocument());
	});

	it('rejects the waiting caller when recovery is declined', async () => {
		renderProvider();

		let pending: Promise<void>;
		act(() => { pending = expireSession()(); });
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());

		const rejection = expect(pending!).rejects.toThrow('declined');
		act(() => { screen.getByText('decline').click(); });

		await rejection;
		await waitFor(() => expect(screen.queryByTestId('session-recovery-popup')).not.toBeInTheDocument());
	});

	// Both buttons stay clickable for the instant before the popup unmounts, so the
	// second settle must be ignored rather than throwing or flipping the outcome.
	it('ignores a second settle after the first', async () => {
		renderProvider();

		let pending: Promise<void>;
		act(() => { pending = expireSession()(); });
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());

		const popup = screen.getByTestId('session-recovery-popup');
		const decline = popup.querySelector('button:nth-of-type(2)') as HTMLButtonElement;
		act(() => { screen.getByText('recover').click(); });
		act(() => { decline.click(); });

		await expect(pending!).resolves.toBeUndefined();
	});

	// Unmounting with a prompt still open would otherwise leave whoever awaited the
	// recovery hanging for the lifetime of the page.
	it('rejects an in-flight recovery when the provider unmounts', async () => {
		const { unmount } = renderProvider();

		let pending: Promise<void>;
		act(() => { pending = expireSession()(); });
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());

		const rejection = expect(pending!).rejects.toThrow('session recovery interrupted');
		unmount();
		await rejection;
	});

	// A fresh expiry after the previous one finished starts a new prompt, proving
	// the de-duplication state is cleared rather than latched.
	it('prompts again after an earlier recovery completed', async () => {
		renderProvider();

		let first: Promise<void>;
		act(() => { first = expireSession()(); });
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());
		act(() => { screen.getByText('recover').click(); });
		await first!;
		await waitFor(() => expect(screen.queryByTestId('session-recovery-popup')).not.toBeInTheDocument());

		let second: Promise<void>;
		act(() => { second = expireSession()(); });
		second!.catch(() => {});

		expect(second!).not.toBe(first!);
		await waitFor(() => expect(screen.getByTestId('session-recovery-popup')).toBeInTheDocument());
	});
});

describe('SessionContextProvider token rejection', () => {
	beforeEach(() => {
		sessionExpiredListeners.length = 0;
		tokenRejectionListeners.length = 0;
		displayError.mockClear();
		apiStub.clearSession.mockClear();
		clientAuthStore.clear.mockClear();
	});

	// A rejected token is unrecoverable, so the session is torn down before the
	// fatal dialog goes up - leaving it in place kept stale credentials around.
	it('clears the session and reports a fatal error', async () => {
		renderProvider();

		const listener = tokenRejectionListeners[tokenRejectionListeners.length - 1];
		expect(listener).toBeDefined();
		await act(async () => { listener(); });

		expect(clientAuthStore.clear).toHaveBeenCalled();
		expect(apiStub.clearSession).toHaveBeenCalled();
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({ fatal: true }),
		);
	});
});
