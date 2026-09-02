import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { OIDFlowError } from '../errors';
import { translateOIDFlowError } from './translateOIDFlowError';

describe('translateOIDFlowError', () => {
	beforeEach(() => {
		i18n.changeLanguage('en');
	});

	it('uses specific copy for known presentation error codes', () => {
		const err = new OIDFlowError({
			code: 'SIGNING_FAILED',
			message: 'Failed to generate VP token',
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'Signing Failed',
			description: 'The wallet could not create a signed presentation. Please try again.',
		});
	});

	it('maps untrusted verifier to specific copy instead of the generic verification error', () => {
		const err = new OIDFlowError({
			code: 'UNTRUSTED_VERIFIER',
			message: 'Verifier is not trusted',
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'Verifier is not Trusted',
			description: 'Verifier did not provide valid data for verification.',
		});
	});

	it('falls back to generic verification copy for unknown codes', () => {
		const err = new OIDFlowError({
			code: 'SOME_NEW_CODE',
			message: 'unexpected',
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'Verification Error',
			description: 'An error occurred during credential verification. Please try again.',
		});
	});

	it('falls back for non-OIDFlow errors', () => {
		expect(translateOIDFlowError(i18n.t.bind(i18n), new Error('boom'), 'vpFlowError').title).toBe(
			'Verification Error',
		);
	});
});
