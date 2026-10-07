import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import type { CachedUser } from '@/services/LocalStorageKeystore';
import StatusContext from '@/context/StatusContext';
import SessionContext from '@/context/SessionContext';
import { useTenant } from '@/context/TenantContext';
import { filterUsersByTenantID } from '@/lib/tenant';
import { useOIDCGate } from '@/hooks/useOIDCGate';
import { usePrfRetry } from '@/hooks/usePrfRetry';
import { useRedirectWhenLoggedIn } from '@/hooks/useRedirectWhenLoggedIn';
import checkForUpdates from '@/offlineUpdateSW';

import AuthLayout from '@/components/Auth/AuthLayout';
import OIDCGateBoundary from '@/components/Auth/OIDCGateBoundary';
import PasskeyProgress from '@/components/Auth/PasskeyProgress';
import PasskeyButtons from '@/components/Auth/PasskeyButtons';
import Button from '@/components/Buttons/Button';
import TenantSelector from '@/components/TenantSelector/TenantSelector';
import PasskeyInfoPopup from '@/components/Popups/PasskeyInfoPopup';

const Login = () => {
	const { isOnline, updateOnlineStatus, blockUpdates } = useContext(StatusContext);
	const { api, keystore } = useContext(SessionContext);
	const { urlTenantId, buildPath } = useTenant();
	const navigate = useNavigate();
	const location = useLocation();
	const { t } = useTranslation();

	const gate = useOIDCGate({ purpose: 'login', redirectUri: window.location.origin + buildPath('/oidc/cb') });
	const prf = usePrfRetry();
	const [inProgress, setInProgress] = useState(false);
	const [error, setError] = useState<React.ReactNode>('');

	const { getCachedUsers } = keystore;
	const cachedUsers = filterUsersByTenantID(urlTenantId, getCachedUsers());
	const [isLoginCache, setIsLoginCache] = useState(cachedUsers.length > 0);
	useEffect(() => {
		setIsLoginCache(filterUsersByTenantID(urlTenantId, getCachedUsers()).length > 0);
	}, [getCachedUsers, urlTenantId]);

	useRedirectWhenLoggedIn(true);

	const onLogin = useCallback(
		async (hints: string[], cachedUser?: CachedUser) => {
			const result = await api.loginWebauthn(keystore, prf.promptForPrfRetry, hints, cachedUser, urlTenantId, gate.idToken || undefined);
			if (result.ok) return;
			switch (result.val) {
				case 'loginKeystoreFailed':
						setError(t('loginSignup.loginKeystoreFailed'));
						break;

					case 'passkeyInvalid':
						setError(t('loginSignup.passkeyInvalid'));
						break;

					case 'passkeyLoginFailedTryAgain':
						setError(t('loginSignup.passkeyLoginFailedTryAgain'));
						break;

					case 'passkeyLoginFailedServerError':
						setError(t('loginSignup.passkeyLoginFailedServerError'));
						break;

					case 'oidcTokenExpired':
						// OIDC gate token has expired — clear it and re-show the gate so the user
						// can re-authenticate via the IdP before retrying the passkey login
						gate.reset();
						setError(t('oidcGate.errorExpired'));
						break;

					case 'x-private-data-etag':
						setError(t('loginSignup.privateDataConflict'));
						break;

					default:
						throw result;
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[api, keystore, urlTenantId, gate.idToken, gate.reset, prf.promptForPrfRetry, t],
	);

	const runLogin = async (tag: string, hints: string[], cachedUser?: CachedUser) => {
		const release = blockUpdates(tag);
		setError('');
		setInProgress(true);
		try {
			await onLogin(hints, cachedUser);
		} finally {
			setInProgress(false);
			checkForUpdates();
			updateOnlineStatus();
			release();
		}
	};

	const onSubmit = (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
		event.preventDefault();
		const hint = (event.nativeEvent?.submitter as HTMLButtonElement)?.value;
		runLogin('login-submit', [hint]);
	};

	const onLoginCachedUser = (cachedUser: CachedUser) => runLogin('login-cached-user', [], cachedUser);
	const onForgetCachedUser = (cachedUser: CachedUser) => keystore.forgetCachedUser(cachedUser);

	const useOtherAccount = () => {
		setIsLoginCache(false);
		setError('');
		checkForUpdates();
		updateOnlineStatus();
	};

	const goToSignup = () => {
		checkForUpdates();
		updateOnlineStatus();
		navigate(buildPath('signup') + location.search);
	};

	// Send old signup URLs (OIDC returns with ?mode=signup, invite links) to /signup
	const params = new URLSearchParams(location.search);
	if (params.get('mode') === 'signup' || params.has('invite')) {
		params.delete('mode');
		const qs = params.toString();
		return <Navigate to={`${buildPath('signup')}${qs ? `?${qs}` : ''}`} replace />;
	}

	return (
		<AuthLayout
			headingKey="loginSignup.loginMessage"
			title={isLoginCache ? t('loginSignup.loginCache') : t('loginSignup.loginTitle')}
			belowCard={!isLoginCache && <PasskeyInfoPopup />}
			footer={<>
				{isLoginCache ? (
					<p className="text-sm font-light text-lm-gray-900 dark:text-dm-gray-100 cursor-pointer">
						<Button id="useOtherAccount-switch-loginsignup" variant="link" onClick={useOtherAccount}>
							{t('loginSignup.useOtherAccount')}
						</Button>
					</p>
				) : (
					<p className="text-sm font-light text-lm-gray-900 dark:text-dm-gray-100">
						{t('loginSignup.newHereQuestion')}
						<Button id="signUp-switch-loginsignup" variant="link" onClick={goToSignup} disabled={!isOnline} title={!isOnline && t('common.offlineTitle')}>
							{t('loginSignup.signUp')}
						</Button>
					</p>
				)}
				<TenantSelector currentTenantId={urlTenantId || 'default'} isAuthenticated={false} button={<Button variant="link" linkClassName="text-sm" />} />
			</>}
		>
			<OIDCGateBoundary gate={gate} purpose="login" error={error}>
				<form className="mb-4" onSubmit={onSubmit}>
					{inProgress ? (
						<PasskeyProgress
							inProgress={inProgress}
							needPrfRetry={prf.needPrfRetry}
							prfRetryAccepted={prf.prfRetryAccepted}
							onPrfAnswer={(accept) => prf.resolvePrfRetryPrompt?.(accept)}
							onCancel={() => { prf.reset(); setInProgress(false); }}
							authOnceMoreMessage={t('loginSignup.authOnceMoreLogin')}
						/>
					) : (
						<>
							{isLoginCache
								? (
							<ul className="overflow-y-auto overflow-x-hidden max-h-32 px-2 custom-scrollbar flex flex-col gap-2">
								{cachedUsers.filter(cachedUser => cachedUser?.prfKeys?.length > 0).map((cachedUser, index) => (
									<li
										key={cachedUser.userHandleB64u}
										className="w-full flex flex-row items-center gap-2"
									>
										<div className="flex flex-1 min-w-0">
											<Button
												id={`login-cached-user-${index}-loginsignup`}
												onClick={() => onLoginCachedUser(cachedUser)}
												size="xl"
												variant="primary"
												disabled={inProgress}
												additionalClassName="w-full"
												ariaLabel={t('loginSignup.loginAsUser', { name: cachedUser.displayName })}
												title={t('loginSignup.loginAsUser', { name: cachedUser.displayName })}
											>
												<span className="truncate">
													{inProgress
														? t('loginSignup.submitting')
														: cachedUser.displayName
													}
												</span>
											</Button>
										</div>
										<div>
											<Button
												id={`forget-cached-user-${index}-loginsignup`}
												onClick={() => onForgetCachedUser(cachedUser)}
												square={true}
												size="xl"
												disabled={inProgress}
												ariaLabel={t('loginSignup.forgetCachedUser', { name: cachedUser.displayName })}
												title={t('loginSignup.forgetCachedUser', { name: cachedUser.displayName })}
											>
												<X size={20} className="text-xl" />
											</Button>
										</div>
									</li>
								))}
							</ul>
							) : <PasskeyButtons mode="login" isSubmitting={inProgress} />}
							{error && <div className="text-lm-red dark:text-dm-red pt-2">{error}</div>}
						</>
					)}
				</form>
			</OIDCGateBoundary>
		</AuthLayout>
	);
};

export default Login;
