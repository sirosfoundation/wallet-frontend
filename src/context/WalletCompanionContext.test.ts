import { describe, expect, it } from 'vitest';

import { ensureWalletCompanionI18nCompatibility } from './WalletCompanionContext';

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
});
