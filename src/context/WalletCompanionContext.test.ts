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
});
