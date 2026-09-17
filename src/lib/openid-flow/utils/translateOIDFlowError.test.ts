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

	it('names the credential types the engine says are missing', () => {
		const err = new OIDFlowError({
			code: 'NO_MATCHING_CREDENTIAL',
			message: 'This request needs a credential you do not have: urn:eudi:pid:1',
			details: { requested_types: ['urn:eudi:pid:1'], no_match_reason: 'No credentials match DCQL query' },
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'No Matching Credential',
			description: 'This request needs a credential you do not have: urn:eudi:pid:1.',
		});
	});

	it('uses the plain copy when the engine names no credential types', () => {
		const err = new OIDFlowError({
			code: 'NO_MATCHING_CREDENTIAL',
			message: 'You do not have a credential that matches this request',
			details: { no_match_reason: 'No credentials could be shaped for matching' },
		});

		expect(translateOIDFlowError(i18n.t.bind(i18n), err, 'vpFlowError')).toEqual({
			title: 'No Matching Credential',
			description: 'You do not have a credential that matches this request.',
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
