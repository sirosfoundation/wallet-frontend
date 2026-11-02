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

	it('names the one credential type the wallet is missing', () => {
		const err = new OIDFlowError({
			code: 'NO_MATCHING_CREDENTIALS',
			message: 'No credentials match DCQL query',
			details: { missing_types: ['urn:eudi:pid:1'] },
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'No Matching Credentials',
			description: 'This request needs a credential you do not have: urn:eudi:pid:1.',
		});
	});

	it('names several missing credential types', () => {
		const err = new OIDFlowError({
			code: 'INSUFFICIENT_CREDENTIALS',
			message: 'Not all required credentials are available',
			details: { missing_types: ['urn:eudi:ehic:1', 'org.iso.18013.5.1.mDL'] },
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'Insufficient Credentials',
			description: 'This request needs credentials you do not have: urn:eudi:ehic:1, org.iso.18013.5.1.mDL.',
		});
	});

	it('uses the plain copy when no missing types are known, ignoring the engine requested_types', () => {
		const err = new OIDFlowError({
			code: 'NO_MATCHING_CREDENTIALS',
			message: 'You do not have a credential that matches this request',
			details: { requested_types: ['urn:eudi:pid:1'] },
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'No Matching Credentials',
			description: 'You do not have any credentials that match this request.',
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
		expect(translateOIDFlowError(i18n.t.bind(i18n), new Error('boom'), 'vpFlowError').title)
			.toBe('Verification Error');
	});
});
