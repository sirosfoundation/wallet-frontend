import type React from 'react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SessionRecoveryPopup } from '@/components/Popups/SessionRecoveryPopup';
import { OHTTP_KEY_CONFIG } from '@/config';
import { useAuthServerClient } from '@/hooks/useAuthServerClient';
import useErrorDialog from '@/hooks/useErrorDialog';
import { useOIDFlowClientAuthStore } from '@/hooks/useOIDFlowClientAuthStore';
import { useLocalStorage, useSessionStorage } from '@/hooks/useStorage';
import { AuthTokens } from '@/lib/auth';
import { getTenantFromUrlPath } from '@/lib/tenant';
import { fetchKeyConfig, type HpkeConfig } from '@/lib/utils/ohttpHelpers';
import { useApi } from '../api';
import { logger } from '../logger';
import keystoreEvents from '../services/keystoreEvents';
import { KeystoreEvent, useLocalStorageKeystore } from '../services/LocalStorageKeystore';
import SessionContext, { type SessionContextValue } from './SessionContext';
import StatusContext from './StatusContext';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export const SessionContextProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);
	const authServerClient = useAuthServerClient();
	const tenantId = getTenantFromUrlPath();
	const authTokens = useMemo(
		() =>
			AuthTokens.fromStorage({
				authServerClient,
				tenantId,
				storage: window.sessionStorage,
			}),
		[authServerClient, tenantId],
	);
	const api = useApi({ isOnline, authTokens });
	const keystore = useLocalStorageKeystore(keystoreEvents);
	const { getCalculatedWalletState } = keystore;
	const isLoggedIn = useMemo(() => api.isLoggedIn() && keystore.isOpen(), [keystore, api]);
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();

	const [walletStateLoaded, setWalletStateLoaded] = useState<boolean>(false);
	const [obliviousKeyConfig, setObliviousKeyConfig] = useState<HpkeConfig>(null);

	const [sessionRecovery, setSessionRecovery] = useState<{
		resolve: () => void;
		reject: (reason?: unknown) => void;
	} | null>(null);

	// A unique id for each logged in tab
	const [globalTabId] = useLocalStorage<string | null>('globalTabId', null);
	const [tabId] = useSessionStorage<string | null>('tabId', null);

	const loginIsOnlineRef = useRef<boolean | null>(null);
	const sessionClearedRef = useRef(false);
	const consumeSessionCleared = useCallback(() => {
		const wasCleared = sessionClearedRef.current;
		sessionClearedRef.current = false;
		return wasCleared;
	}, []);

	const oidFlowClientAuthMaterialManager = useOIDFlowClientAuthStore();

	// Use a ref to hold a stable reference to the clearSession function
	const clearSessionRef = useRef<() => void>(null);

	// Memoize clearSession using useCallback
	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	const clearSession = useCallback(async () => {
		window.history.replaceState({}, '', `${window.location.pathname}`);
		sessionClearedRef.current = true;
		oidFlowClientAuthMaterialManager.clear();
		logger.debug('[Session Context] Clear Session');
		api.clearSession();
	}, [api, oidFlowClientAuthMaterialManager]);

	// Update the ref whenever clearSession changes
	useEffect(() => {
		clearSessionRef.current = clearSession;
	}, [clearSession]);

	// The close() will dispatch Event CloseSessionTabLocal in order to call the clearSession
	const logout = useCallback(async () => {
		logger.debug('[Session Context] Close Keystore');
		oidFlowClientAuthMaterialManager.clear();
		await keystore.close();
	}, [keystore, oidFlowClientAuthMaterialManager]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		return authTokens.onTokenRejection(() => {
			displayError({
				title: t('errors.walletServiceAuth.title'),
				description: t('errors.walletServiceAuth.description'),
				fatal: true,
			});
		});
	}, [displayError, clearSession, authTokens, t]);

	useEffect(() => {
		return authTokens.onSessionExpired(
			() =>
				new Promise<void>((resolve, reject) => {
					setSessionRecovery({
						resolve: () => {
							setSessionRecovery(null);
							resolve();
						},
						reject: (e) => {
							setSessionRecovery(null);
							reject(e);
						},
					});
				}),
		);
	}, [authTokens]);

	useEffect(() => {
		// Handler function that calls the current clearSession function
		const handleClearSession = () => {
			if (clearSessionRef.current) {
				clearSessionRef.current();
			}
		};

		// Add event listener
		keystoreEvents.addEventListener(KeystoreEvent.CloseSessionTabLocal, handleClearSession);

		// Cleanup event listener to prevent duplicates
		return () => {
			keystoreEvents.removeEventListener(KeystoreEvent.CloseSessionTabLocal, handleClearSession);
		};
	}, []);

	useEffect(() => {
		const S = getCalculatedWalletState();
		if (S) {
			// biome-ignore lint/complexity/useLiteralKeys: baseline: pre-existing debt. should be fixed
			if (S.settings['useOblivious'] === 'true') {
				// To use oblivious, keys must be fetched.
				// Delay setWalletStateLoaded till then.
				async function fetchKeyConfigAndUpdate() {
					const keyConfig = await fetchKeyConfig(OHTTP_KEY_CONFIG);
					setObliviousKeyConfig(keyConfig);
					setWalletStateLoaded(true);
				}
				fetchKeyConfigAndUpdate();
			} else {
				setObliviousKeyConfig(null);
				setWalletStateLoaded(true);
			}
		}
	}, [getCalculatedWalletState]);

	const value: SessionContextValue = useMemo(
		() => ({
			api,
			isLoggedIn: isLoggedIn,
			keystore,
			logout,
			obliviousKeyConfig,
			consumeSessionCleared,
			oidFlowClientAuthMaterialManager,
			authTokens,
		}),
		[
			api,
			keystore,
			logout,
			isLoggedIn,
			obliviousKeyConfig,
			consumeSessionCleared,
			oidFlowClientAuthMaterialManager,
			authTokens,
		],
	);

	useEffect(() => {
		if (
			api &&
			keystore &&
			api.isLoggedIn() === true &&
			keystore.isOpen() === false &&
			((tabId && globalTabId && tabId !== globalTabId) || (!tabId && globalTabId))
		) {
			clearSession();
		}
	}, [globalTabId, tabId, clearSession, api, keystore]);

	useEffect(() => {
		if (isLoggedIn === true) {
			if (loginIsOnlineRef.current === null) {
				loginIsOnlineRef.current = isOnline;
			} else if (loginIsOnlineRef.current !== isOnline) {
				logout();
			}
		} else {
			loginIsOnlineRef.current = null;
		}
	}, [isLoggedIn, isOnline, logout]);

	if (api.isLoggedIn() === true && (keystore.isOpen() === false || !walletStateLoaded)) {
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		return <></>;
	}
	return (
		<SessionContext.Provider value={value}>
			{children}
			{sessionRecovery && (
				<SessionRecoveryPopup recovery={sessionRecovery} onLogout={() => logout()} />
			)}
		</SessionContext.Provider>
	);
};
