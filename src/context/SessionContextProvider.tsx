import React, { useContext, useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StatusContext from './StatusContext';
import { useApi } from '../api';
import { KeystoreEvent, useLocalStorageKeystore } from '../services/LocalStorageKeystore';
import keystoreEvents from '../services/keystoreEvents';
import SessionContext, { SessionContextValue } from './SessionContext';
import { useLocalStorage, useSessionStorage } from '@/hooks/useStorage';
import { fetchKeyConfig, HpkeConfig } from '@/lib/utils/ohttpHelpers';
import { OHTTP_KEY_CONFIG } from '@/config';
import { logger } from '../logger';
import useErrorDialog from '@/hooks/useErrorDialog';

export const SessionContextProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);
	const api = useApi(isOnline);
	const keystore = useLocalStorageKeystore(keystoreEvents);
	const { getCalculatedWalletState } = keystore;
	const isLoggedIn = useMemo(() => api.isLoggedIn() && keystore.isOpen(), [keystore, api]);
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();

	const [walletStateLoaded, setWalletStateLoaded] = useState<boolean>(false);
	const [obliviousKeyConfig, setObliviousKeyConfig] = useState<HpkeConfig>(null);

	// A unique id for each logged in tab
	const [globalTabId] = useLocalStorage<string | null>("globalTabId", null);
	const [tabId] = useSessionStorage<string | null>("tabId", null);

	const loginIsOnlineRef = useRef<boolean | null>(null);
	const loggingOutRef = useRef(false);
	const isLoggingOut = useCallback(() => loggingOutRef.current, []);
	const finishLogout = useCallback(() => { loggingOutRef.current = false; }, []);

	// Use a ref to hold a stable reference to the clearSession function
	const clearSessionRef = useRef<() => void>();

	// Memoize clearSession using useCallback
	const clearSession = useCallback(async () => {
		window.history.replaceState({}, '', `${window.location.pathname}`);
		loggingOutRef.current = true;
		logger.debug('[Session Context] Clear Session');
		api.clearSession();
	}, [api]);

	// Update the ref whenever clearSession changes
	useEffect(() => {
		clearSessionRef.current = clearSession;
	}, [clearSession]);

	// The close() will dispatch Event CloseSessionTabLocal in order to call the clearSession
	const logout = useCallback(async () => {
		logger.debug('[Session Context] Close Keystore');
		await keystore.close();
	}, [keystore]);

	useEffect(() => {
		return api.authTokens.onTokenRejection(() => {
			displayError({
				title: t('errors.walletServiceAuth.title'),
				description: t('errors.walletServiceAuth.description'),
				fatal: true,
			});
		});
	}, [displayError, clearSession, api.authTokens, t]);

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
			if (S.settings['useOblivious'] === "true") {
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

	const value: SessionContextValue = useMemo(() => ({
		api,
		isLoggedIn: isLoggedIn,
		keystore,
		logout,
		obliviousKeyConfig,
		isLoggingOut,
		finishLogout
	}), [api, keystore, logout, isLoggedIn, obliviousKeyConfig, isLoggingOut, finishLogout]);

	useEffect(() => {
		if (api && keystore && api.isLoggedIn() === true && keystore.isOpen() === false && ((tabId && globalTabId && tabId !== globalTabId) || (!tabId && globalTabId))) {
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

	if ((api.isLoggedIn() === true && (keystore.isOpen() === false || !walletStateLoaded))) {
		return <></>
	}
	return (
		<SessionContext.Provider value={value}>
			{children}
		</SessionContext.Provider>
	);
};
