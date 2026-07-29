import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, afterEach, vi } from 'vitest';

vi.mock('@/config', () => ({
	WALLET_COMPANION_INTEGRATION: true,
	I18N_WALLET_NAME_OVERRIDE: undefined,
	STATIC_NAME: 'Test Wallet',
	STATIC_PUBLIC_URL: 'https://wallet.example',
}));

let ensureWalletCompanionI18nCompatibility: typeof import('./WalletCompanionContext').ensureWalletCompanionI18nCompatibility;
let WalletCompanionProvider: typeof import('./WalletCompanionContext').WalletCompanionProvider;
let useWalletCompanion: typeof import('./WalletCompanionContext').useWalletCompanion;

beforeAll(async () => {
	({
		ensureWalletCompanionI18nCompatibility,
		WalletCompanionProvider,
		useWalletCompanion,
	} = await import('./WalletCompanionContext'));
});

const originalWalletCompanion = (window as typeof window & { WalletCompanion?: unknown }).WalletCompanion;
const originalChrome = (window as typeof window & { chrome?: unknown }).chrome;

afterEach(() => {
	const walletCompanionWindow = window as typeof window & {
		WalletCompanion?: unknown;
		chrome?: unknown;
	};

	if (originalWalletCompanion === undefined) {
		delete walletCompanionWindow.WalletCompanion;
	} else {
		walletCompanionWindow.WalletCompanion = originalWalletCompanion;
	}

	if (originalChrome === undefined) {
		delete walletCompanionWindow.chrome;
	} else {
		walletCompanionWindow.chrome = originalChrome;
	}

	vi.clearAllMocks();
});

describe('ensureWalletCompanionI18nCompatibility', () => {
	it('adds a getUILanguage fallback for chrome runtime when missing', () => {
		const walletCompanionWindow = {
			navigator: {
				language: 'en-US',
				languages: ['sv-SE', 'en-US'],
			},
			chrome: {
				runtime: {},
			},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow);

		expect(walletCompanionWindow.chrome.i18n?.getUILanguage?.()).toBe('sv-SE');
	});

	it('does not override an existing getUILanguage implementation', () => {
		const getUILanguage = () => 'fi-FI';
		const walletCompanionWindow = {
			navigator: {
				language: 'en-US',
				languages: ['sv-SE', 'en-US'],
			},
			browser: {
				runtime: {},
				i18n: {
					getUILanguage,
				},
			},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow);

		expect(walletCompanionWindow.browser.i18n?.getUILanguage).toBe(getUILanguage);
	});

	it('adds a getUILanguage fallback for browser runtime when missing', () => {
		const walletCompanionWindow = {
			navigator: {
				language: 'en-US',
				languages: ['pt-BR', 'en-US'],
			},
			browser: {
				runtime: {},
			},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow);

		expect(walletCompanionWindow.browser.i18n?.getUILanguage?.()).toBe('pt-BR');
	});

	it('falls back to navigator.language when navigator.languages is unavailable', () => {
		const walletCompanionWindow = {
			navigator: {
				language: 'el-GR',
			},
			chrome: {
				runtime: {},
			},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow);

		expect(walletCompanionWindow.chrome.i18n?.getUILanguage?.()).toBe('el-GR');
	});

	it('falls back to en when no navigator language is available', () => {
		const walletCompanionWindow = {
			navigator: {},
			chrome: {
				runtime: {},
			},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow as {
			navigator: {
				language?: string;
				languages?: readonly string[];
			};
			chrome: {
				runtime: {};
				i18n?: {
					getUILanguage?: () => string;
				};
			};
		});

		expect(walletCompanionWindow.chrome.i18n?.getUILanguage?.()).toBe('en');
	});

	it('does not add a getUILanguage fallback when the runtime API is missing', () => {
		const walletCompanionWindow = {
			navigator: {
				language: 'en-US',
				languages: ['sv-SE', 'en-US'],
			},
			chrome: {},
		};

		ensureWalletCompanionI18nCompatibility(walletCompanionWindow);

		expect(walletCompanionWindow.chrome).not.toHaveProperty('i18n');
	});
});

describe('WalletCompanionProvider', () => {
	it('registers with the static name fallback and installs Safari i18n compatibility', async () => {
		const registerWallet = vi.fn().mockResolvedValue({ success: true });
		const isWalletRegistered = vi.fn().mockResolvedValue(false);
		const walletCompanionWindow = window as typeof window & {
			WalletCompanion?: {
				isWalletRegistered: typeof isWalletRegistered;
				registerWallet: typeof registerWallet;
			};
			chrome?: {
				runtime: {};
				i18n?: {
					getUILanguage?: () => string;
				};
			};
		};

		walletCompanionWindow.WalletCompanion = {
			isWalletRegistered,
			registerWallet,
		};
		walletCompanionWindow.chrome = {
			runtime: {},
		};

		const wrapper = ({ children }: { children: React.ReactNode }) =>
			React.createElement(WalletCompanionProvider, null, children);

		const { result } = renderHook(() => useWalletCompanion(), { wrapper });

		await waitFor(() => expect(result.current?.isLoading).toBe(false));

		await act(async () => {
			await result.current?.register();
		});

		expect(registerWallet).toHaveBeenCalledWith({
			name: 'Test Wallet',
			url: 'https://wallet.example',
			protocols: [
				'openid4vp-v1',
				'openid4vp-v1-signed',
				'openid4vp-v1-unsigned'
			],
		});
		expect(walletCompanionWindow.chrome.i18n?.getUILanguage?.()).toBe(
			window.navigator.languages?.[0] ?? window.navigator.language ?? 'en'
		);
		await waitFor(() => expect(result.current?.isRegistered).toBe(true));
	});
});
