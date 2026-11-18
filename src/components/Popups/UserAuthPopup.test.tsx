import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionContext from '@/context/SessionContext';
import { UserAuthPopup } from './UserAuthPopup';

const mockCheckForUpdates = vi.fn();
const mockUseTenant = vi.fn(() => ({ effectiveTenantId: 'tenant-1' }));
const mockT = vi.fn((key: string) => ({
	'loginState.title': 'Continue as',
	'loginSignup.loginWithPasskey': 'Login with passkey',
	'loginSignup.submitting': 'Submitting',
	'loginSignup.passkeyInvalid': 'Translated invalid passkey',
	'common.declineAndExit': 'Decline and exit',
}[key] ?? key));

vi.mock('@/context/TenantContext', () => ({
	useTenant: () => mockUseTenant(),
}));

vi.mock('@/offlineUpdateSW', () => ({
	default: () => mockCheckForUpdates(),
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: mockT }),
	Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

vi.mock('./PopupLayout', () => ({
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('UserAuthPopup', () => {
	const user = { displayName: 'Ada', userHandleB64u: 'user-1' };
	const onSuccess = vi.fn();
	const onLogout = vi.fn();
	const onDismiss = vi.fn();
	const loginWebauthn = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		mockUseTenant.mockReturnValue({ effectiveTenantId: 'tenant-1' });
	});

	const renderPopup = () =>
		render(
			<SessionContext.Provider
				value={{
					api: { loginWebauthn } as never,
					isLoggedIn: false,
					keystore: {} as never,
					logout: async () => {},
					consumeSessionCleared: () => false,
					obliviousKeyConfig: null,
					oidFlowClientAuthMaterialManager: {} as never,
					authTokens: {} as never,
				}}
			>
				<UserAuthPopup
					user={user as never}
					message={{ description: 'sessionRecoveryPopup.sessionExpired' }}
					onLogout={onLogout}
					onDismiss={onDismiss}
					onSuccess={onSuccess}
				/>
			</SessionContext.Provider>,
		);

	it('re-authenticates successfully with the tenant-scoped cached user', async () => {
		loginWebauthn.mockResolvedValue({ ok: true });
		renderPopup();

		fireEvent.click(screen.getByRole('button', { name: 'Login with passkey' }));

		await waitFor(() => expect(loginWebauthn).toHaveBeenCalledTimes(1));
		expect(loginWebauthn).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Function),
			[],
			user,
			'tenant-1',
		);
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
	});

	it('shows the translated passkey error and re-enables submission', async () => {
		loginWebauthn.mockResolvedValue({ ok: false, val: 'passkeyInvalid' });
		renderPopup();

		const button = screen.getByRole('button', { name: 'Login with passkey' });
		fireEvent.click(button);

		await waitFor(() => expect(screen.getByText('Translated invalid passkey')).toBeInTheDocument());
		expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
		expect(onSuccess).not.toHaveBeenCalled();
		expect(button).not.toBeDisabled();
	});
});
