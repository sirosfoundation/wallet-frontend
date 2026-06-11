import { I18N_WALLET_NAME_OVERRIDE, STATIC_PUBLIC_URL } from '@/config';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
	const api = (window as any).WalletCompanion as WalletCompanionAPI | null;

	const [isRegistered, setIsRegistered] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const walletUrl = STATIC_PUBLIC_URL;

	useEffect(() => {
		if (!api) {
			setIsLoading(false);
			return;
		}
		api.isWalletRegistered(walletUrl)
			.then(setIsRegistered)
			.finally(() => setIsLoading(false));
	}, [api, walletUrl]);

	const register = async () => {
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
	};

	const value = api ? { api, isRegistered, isLoading, register } : null;

	return (
		<WalletCompanionContext.Provider value={value}>
			{children}
		</WalletCompanionContext.Provider>
	);
};

export function useWalletCompanion() {
	return useContext(WalletCompanionContext);
}
