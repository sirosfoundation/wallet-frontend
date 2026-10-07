import React, { useContext, useState, ChangeEventHandler } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

import { calculateByteSize } from '@/lib/utils';
import StatusContext from '@/context/StatusContext';
import SessionContext from '@/context/SessionContext';
import { useTenant } from '@/context/TenantContext';
import { useOIDCGate } from '@/hooks/useOIDCGate';
import { usePrfRetry } from '@/hooks/usePrfRetry';
import { useRedirectWhenLoggedIn } from '@/hooks/useRedirectWhenLoggedIn';
import { usePolicyLinks } from '@/hooks/usePolicyLinks';
import checkForUpdates from '@/offlineUpdateSW';
import type { BackendApi } from '@/api';

import AuthLayout from '@/components/Auth/AuthLayout';
import OIDCGateBoundary from '@/components/Auth/OIDCGateBoundary';
import PasskeyProgress from '@/components/Auth/PasskeyProgress';
import PasskeyButtons from '@/components/Auth/PasskeyButtons';
import Button from '@/components/Buttons/Button';
import TenantSelector from '@/components/TenantSelector/TenantSelector';
import PolicyLinks from '@/components/Shared/PolicyLinks';
import PasskeyInfoPopup from '@/components/Popups/PasskeyInfoPopup';

const FormInputRow = ({
	IconComponent,
	children,
	label,
	name,
}) => (
	<div className="mb-4 relative">
		<label className="block text-lm-gray-800 dark:text-dm-gray-200 text-sm font-bold mb-2" htmlFor={name}>
			<IconComponent size={20} className="absolute left-3 top-10 z-10 text-lm-gray-700 dark:text-dm-gray-300" />
			{label}
		</label>
		{children}
	</div>
);

const FormInputField = ({
	ariaLabel,
	disabled,
	name,
	onChange,
	placeholder,
	required,
	value,
}: {
	ariaLabel?: string,
	disabled?: boolean,
	name: string,
	onChange: ChangeEventHandler<HTMLInputElement>,
	placeholder?: string,
	required?: boolean,
	value: string,
}) => {
	return (
		<div className="relative">
			<input
				className="w-full pl-10 pr-3 py-2 bg-lm-gray-200 dark:bg-dm-gray-800 border border-lm-gray-400 dark:border-dm-gray-600 dark:text-white rounded-lg dark:inputDarkModeOverride"
				type="text"
				name={name}
				placeholder={placeholder}
				value={value}
				onChange={onChange}
				aria-label={ariaLabel}
				required={required}
				disabled={disabled}
			/>
		</div>
	);
};

const NAME_BYTE_LIMIT = 64;
type SignupRetryParams = Parameters<BackendApi['signupWebauthn']>[4];

const Signup = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [name, setName] = useState('');
	const { isOnline, updateOnlineStatus, blockUpdates } = useContext(StatusContext);
	const { api, keystore } = useContext(SessionContext);
	const { urlTenantId, buildPath } = useTenant();
	const location = useLocation();
	const { hasPolicyLinks } = usePolicyLinks();

	const gate = useOIDCGate({ purpose: 'registration', redirectUri: window.location.origin + buildPath('/oidc/cb') });
	const prf = usePrfRetry();
	const [inProgress, setInProgress] = useState(false);
	const [error, setError] = useState<React.ReactNode>('');
	const [retrySignupFrom, setRetrySignupFrom] = useState<SignupRetryParams | null>(null);

	const inviteCode = new URLSearchParams(location.search).get('invite') || undefined;

	useRedirectWhenLoggedIn(false);

	const onSignup = async (hints: string[]) => {
		const result = await api.signupWebauthn(
			name,
			keystore,
			retrySignupFrom ? async () => true : prf.promptForPrfRetry,
			hints,
			retrySignupFrom,
			urlTenantId || 'default',
			inviteCode,
			gate.idToken || undefined,
		);
		if (result.err) {
		switch (result.val) {
			case 'passkeySignupFailedServerError':
								setError(t('loginSignup.passkeySignupFailedServerError'));
								break;

							case 'passkeySignupFailedTryAgain':
								setError(t('loginSignup.passkeySignupFailedTryAgain'));
								break;

							case 'passkeySignupFinishFailedServerError':
								setError(t('loginSignup.passkeySignupFinishFailedServerError'));
								break;

							case 'passkeySignupKeystoreFailed':
								setError(t('loginSignup.passkeySignupKeystoreFailed'));
								break;

							case 'inviteRequired':
								setError(t('loginSignup.inviteRequired'));
								break;

							case 'inviteInvalid':
								setError(t('loginSignup.inviteInvalid'));
								break;

							case 'oidcTokenExpired':
								// OIDC gate token has expired — clear it and re-show the gate so the user
								// can re-authenticate via the IdP before retrying the passkey registration
								gate.reset();
								setError(t('oidcGate.errorExpired'));
								break;

							case 'passkeySignupPrfNotSupported':
								setError(
									<Trans
										i18nKey="loginSignup.passkeySignupPrfNotSupported"
										components={{
											docLink: <a
												href="https://github.com/wwWallet/wallet-frontend#prf-compatibility" target='blank_'
												className="font-medium text-lm-gray-900 hover:underline dark:text-dm-gray-100"
												aria-label={t('loginSignup.passkeySignupPrfNotSupportedAriaLabel')}
											/>
										}}
									/>
								);
								break;

							default:
								if (result.val?.errorId === 'prfRetryFailed') {
									setRetrySignupFrom(result.val?.retryFrom);

								} else {
									setError(t('loginSignup.passkeySignupPrfRetryFailed'));
									throw result;
								}
		}
	}
};

	const onSubmit = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
		event.preventDefault();
		const hint = (event.nativeEvent?.submitter as HTMLButtonElement)?.value;
		const release = blockUpdates('signup-submit');
		setError('');
		setInProgress(true);
		try {
			await onSignup([hint]);
		} finally {
			setInProgress(false);
			checkForUpdates();
			updateOnlineStatus();
			release();
		}
	};

	const onCancel = () => {
		prf.reset();
		setInProgress(false);
		setRetrySignupFrom(null);
	};

	const goToLogin = () => {
		// Implement navigation to the login page
		checkForUpdates();
		updateOnlineStatus();
		navigate(buildPath('login') + location.search);
	};

	const nameByteLength = calculateByteSize(name);
	const nameByteLimitReached = nameByteLength >= NAME_BYTE_LIMIT;
	const nameByteLimitApproaching = nameByteLength >= NAME_BYTE_LIMIT / 2;

	return (
		<AuthLayout
			headingKey="loginSignup.welcomeMessage"
			title={t('loginSignup.signUp')}
			belowCard={<PasskeyInfoPopup />}
			footer={<>
				<p className="text-sm font-light text-lm-gray-900 dark:text-dm-gray-100">
					{t('loginSignup.alreadyHaveAccountQuestion')}
					<Button id="loginSignup.login-switch-loginsignup" variant="link" onClick={goToLogin} disabled={!isOnline} title={!isOnline && t('common.offlineTitle')}>
						{t('loginSignup.login')}
					</Button>
				</p>
				<TenantSelector currentTenantId={urlTenantId || 'default'} isAuthenticated={false} button={<Button variant="link" linkClassName="text-sm" />} />
			</>}
		>
			<OIDCGateBoundary gate={gate} purpose="registration" username={name} error={error}>
				<form className="mb-4" onSubmit={onSubmit}>
					{inProgress || retrySignupFrom ? (
						<PasskeyProgress
							inProgress={inProgress}
							needPrfRetry={prf.needPrfRetry}
							prfRetryAccepted={prf.prfRetryAccepted}
							onPrfAnswer={(accept) => prf.resolvePrfRetryPrompt?.(accept)}
							onCancel={onCancel}
							authOnceMoreMessage={t('registerPasskey.authOnceMore')}
							showTryAgain={!!retrySignupFrom}
						/>
					) : (
						<>
							<FormInputRow label={t('loginSignup.choosePasskeyUsername')} name="name" IconComponent={Wallet}>
									<FormInputField
										ariaLabel="Passkey name"
										name="name"
										onChange={(event) => setName(event.target.value)}
										placeholder={t('loginSignup.enterPasskeyName')}
										value={name}
										required
									/>
									<div className={`flex flex-row flex-nowrap text-lm-gray-500 text-sm italic ${nameByteLimitReached ? 'text-lm-red' : ''} ${nameByteLimitApproaching ? 'h-auto mt-1' : 'h-0 mt-0'} transition-all`}>
										<div
											className={`text-lm-red dark:text-dm-red grow ${nameByteLimitReached ? 'opacity-100' : 'opacity-0 select-none'} transition-opacity`}
											aria-hidden={!nameByteLimitReached}
										>
											{t('loginSignup.reachedLengthLimit')}
										</div>
										<div
											className={`text-right ${nameByteLimitApproaching ? 'opacity-100' : 'opacity-0 select-none'} transition-opacity`}
											aria-hidden={!nameByteLimitApproaching}
										>
											{nameByteLength + `/64`}
										</div>
									</div>
								</FormInputRow>
								{hasPolicyLinks && (
									<label className="mb-4 text-sm relative block pl-6">
										<input className="absolute top-1 left-0 w-4 h-4 accent-primary cursor-pointer" type="checkbox" required />
										<span>
											<Trans
												i18nKey="loginSignup.acceptPolicies"
												components={{ policyLinks: <PolicyLinks /> }}
											/>
										</span>
									</label>
								)}
								<PasskeyButtons mode="signup" isSubmitting={inProgress} />
								{error && <div className="text-lm-red dark:text-dm-red text-sm mt-2">{error}</div>}
						</>
					)}
				</form>
			</OIDCGateBoundary>
		</AuthLayout>
	);
};

export default Signup;
