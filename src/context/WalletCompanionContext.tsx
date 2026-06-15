import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import {
	WALLET_COMPANION_INTEGRATION,
	I18N_WALLET_NAME_OVERRIDE,
	STATIC_PUBLIC_URL
} from '@/config';

type WalletRegistrationInput = {
	name: string;
	url: string;
	icon?: string | null;
	logo?: string | null;
	description?: string | null;
	color?: string | null;
	protocols?: string[] | null;
}

type WalletRegistrationResult =  {
	success: boolean;
	alreadyRegistered: boolean;
}

type WalletCompanionAPI = {
	readonly version: string;
	readonly isInstalled: boolean;
	readonly supportedProtocols: readonly string[];
	registerWallet(walletInfo: WalletRegistrationInput): Promise<WalletRegistrationResult>;
	isWalletRegistered(url: string): Promise<boolean>;
}

type WalletCompanionContextValue = {
	api: WalletCompanionAPI | null;
	isRegistered: boolean;
	isLoading: boolean;
	register: () => Promise<void>;
}

const WalletCompanionContext = createContext<WalletCompanionContextValue | null>(null);

export const WalletCompanionProvider = ({ children }: { children: ReactNode }) => {
	const [api] = useState<WalletCompanionAPI | null>(
		() => (window as any).WalletCompanion ?? null
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
		const result = await api.registerWallet({
			name: I18N_WALLET_NAME_OVERRIDE,
			url: walletUrl,
			protocols: [
				'openid4vp-v1',
				'openid4vp-v1-signed',
				'openid4vp-v1-unsigned'
			],
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
