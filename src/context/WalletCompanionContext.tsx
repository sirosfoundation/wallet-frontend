import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { type WalletCompanionInterface } from '@sirosfoundation/wcc-types';
import {
	WALLET_COMPANION_INTEGRATION,
	I18N_WALLET_NAME_OVERRIDE,
	STATIC_NAME,
	STATIC_PUBLIC_URL
} from '@/config';

type WalletCompanionContextValue = {
	api: WalletCompanionInterface | null;
	isRegistered: boolean;
	isLoading: boolean;
	register: () => Promise<void>;
}

const WalletCompanionContext = createContext<WalletCompanionContextValue | null>(null);

type WalletCompanionBrowserApi = {
	runtime?: unknown;
	i18n?: {
		getUILanguage?: () => string;
	};
};

type WalletCompanionWindow = {
	navigator: Pick<Navigator, 'language' | 'languages'>;
	browser?: WalletCompanionBrowserApi;
	chrome?: WalletCompanionBrowserApi;
};

export const WALLET_COMPANION_PROTOCOLS = [
	'openid4vp-v1',
	'openid4vp-v1-signed',
	'openid4vp-v1-unsigned'
] as const;

export function ensureWalletCompanionI18nCompatibility(
	walletCompanionWindow: WalletCompanionWindow = window
) {
	const getFallbackLanguage = () =>
		walletCompanionWindow.navigator.languages?.[0] ??
		walletCompanionWindow.navigator.language ??
		'en';

	const ensureBrowserApiI18n = (browserApi?: WalletCompanionBrowserApi) => {
		if (!browserApi?.runtime || typeof browserApi.i18n?.getUILanguage === 'function') return;

		browserApi.i18n = {
			...browserApi.i18n,
			getUILanguage: getFallbackLanguage,
		};
	};

	ensureBrowserApiI18n(walletCompanionWindow.browser);
	ensureBrowserApiI18n(walletCompanionWindow.chrome);
}

export const WalletCompanionProvider = ({ children }: { children: ReactNode }) => {
	const [api] = useState<WalletCompanionInterface | null>(
		() => window.WalletCompanion ?? null
	);

	const [isRegistered, setIsRegistered] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const walletUrl = STATIC_PUBLIC_URL;

	useEffect(() => {
		if (!api) {
			setIsLoading(false);
			return;
		}

		(async () => {
			const registered = await api.isWalletRegistered(walletUrl);
			setIsRegistered(registered);
			setIsLoading(false);
		})();
	}, [api, walletUrl]);

	const register = useCallback(async () => {
		if (!api) return;
		ensureWalletCompanionI18nCompatibility();
		const result = await api.registerWallet({
			name: I18N_WALLET_NAME_OVERRIDE ?? STATIC_NAME,
			url: walletUrl,
			protocols: [...WALLET_COMPANION_PROTOCOLS],
		});
		if (result.success) setIsRegistered(true);
	}, [api, walletUrl]);

	const value = useMemo(() =>
		api && WALLET_COMPANION_INTEGRATION
			? { api, isRegistered, isLoading, register }
			: null,
		[api, isRegistered, isLoading, register]
	);

	return (
		<WalletCompanionContext.Provider value={value}>
			{children}
		</WalletCompanionContext.Provider>
	);
};

export function useWalletCompanion() {
	return useContext(WalletCompanionContext);
}
