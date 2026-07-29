import { createElement, type ReactNode } from 'react';
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
let WALLET_COMPANION_PROTOCOLS: typeof import('./WalletCompanionContext').WALLET_COMPANION_PROTOCOLS;
let useWalletCompanion: typeof import('./WalletCompanionContext').useWalletCompanion;
let originalWalletCompanion: unknown;
let originalChrome: unknown;
let hadOriginalWalletCompanion: boolean;
let hadOriginalChrome: boolean;
let originalNavigatorLanguage: PropertyDescriptor | undefined;
let originalNavigatorLanguages: PropertyDescriptor | undefined;

beforeAll(async () => {
	({
		ensureWalletCompanionI18nCompatibility,
		WalletCompanionProvider,
		WALLET_COMPANION_PROTOCOLS,
		useWalletCompanion,
	} = await import('./WalletCompanionContext'));

	hadOriginalWalletCompanion = Object.prototype.hasOwnProperty.call(window, 'WalletCompanion');
	hadOriginalChrome = Object.prototype.hasOwnProperty.call(window, 'chrome');
	originalWalletCompanion = (window as typeof window & { WalletCompanion?: unknown }).WalletCompanion;
	originalChrome = (window as typeof window & { chrome?: unknown }).chrome;
	originalNavigatorLanguage = Object.getOwnPropertyDescriptor(window.navigator, 'language');
	originalNavigatorLanguages = Object.getOwnPropertyDescriptor(window.navigator, 'languages');
});

afterEach(() => {
	const walletCompanionWindow = window as typeof window & {
		WalletCompanion?: unknown;
		chrome?: unknown;
	};

	if (hadOriginalWalletCompanion) {
		walletCompanionWindow.WalletCompanion = originalWalletCompanion;
	} else {
		delete walletCompanionWindow.WalletCompanion;
	}

	if (hadOriginalChrome) {
		walletCompanionWindow.chrome = originalChrome;
	} else {
		delete walletCompanionWindow.chrome;
	}

	if (originalNavigatorLanguage) {
		Object.defineProperty(window.navigator, 'language', originalNavigatorLanguage);
	} else {
		delete (window.navigator as Navigator & { language?: string }).language;
	}

	if (originalNavigatorLanguages) {
		Object.defineProperty(window.navigator, 'languages', originalNavigatorLanguages);
	} else {
		delete (window.navigator as Navigator & { languages?: readonly string[] }).languages;
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

	it('does not add a getUILanguage fallback when chrome.runtime is missing', () => {
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

	it('does not throw when the browser APIs are absent', () => {
		expect(() =>
			ensureWalletCompanionI18nCompatibility({
				navigator: {
					language: 'en-US',
					languages: ['en-US'],
				},
			})
		).not.toThrow();
	});
});

describe('WalletCompanionProvider', () => {
	it('registers with the static name fallback and installs Safari i18n compatibility using navigator.languages[0]', async () => {
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
		Object.defineProperty(window.navigator, 'language', {
			configurable: true,
			value: 'en-US',
		});
		Object.defineProperty(window.navigator, 'languages', {
			configurable: true,
			value: ['sv-SE', 'en-US'],
		});

		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(
				WalletCompanionProvider,
				{ walletCompanionWindow },
				children
			);

		const { result } = renderHook(() => useWalletCompanion(), { wrapper });

		await waitFor(() => expect(result.current?.isLoading).toBe(false));

		await act(async () => {
			await result.current?.register();
		});

		expect(registerWallet).toHaveBeenCalledWith({
			name: 'Test Wallet',
			url: 'https://wallet.example',
			protocols: [...WALLET_COMPANION_PROTOCOLS],
		});
		expect(walletCompanionWindow.chrome.i18n?.getUILanguage?.()).toBe('sv-SE');
		await waitFor(() => expect(result.current?.isRegistered).toBe(true));
	});
});
