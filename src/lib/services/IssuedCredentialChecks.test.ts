import { describe, expect, it } from 'vitest';
import { CredentialParsingError } from 'wallet-common';
import {
	declaredVct,
	integrityFailure,
	issuedTypeMismatch,
} from './IssuedCredentialChecks';

describe('issuedTypeMismatch', () => {
	it('accepts a credential of the offered type', () => {
		expect(issuedTypeMismatch('urn:eudi:pid:1', 'urn:eudi:pid:1')).toBeNull();
	});

	it('refuses a credential of a different type', () => {
		// The whole point: an issuer entitled to one attestation type must not
		// be able to deliver another and have every earlier decision stand.
		const reason = issuedTypeMismatch('urn:eudi:pid:1', 'urn:example:other');
		expect(reason).not.toBeNull();
		expect(reason).toContain('urn:example:other');
		expect(reason).toContain('urn:eudi:pid:1');
	});

	it('does not refuse when either side is missing', () => {
		// A check that could not run must not become a refusal - an mdoc has no
		// vct at all, and an older engine may not report one.
		expect(issuedTypeMismatch(undefined, 'urn:eudi:pid:1')).toBeNull();
		expect(issuedTypeMismatch('urn:eudi:pid:1', undefined)).toBeNull();
		expect(issuedTypeMismatch(undefined, undefined)).toBeNull();
		expect(issuedTypeMismatch('', 'urn:eudi:pid:1')).toBeNull();
	});
});

describe('integrityFailure', () => {
	it('refuses when the issuer pinned metadata that does not match', () => {
		// wallet-common reports this as a warning, and warnings are invisible
		// unless DISPLAY_ISSUANCE_WARNINGS is on - which it is not by default.
		const reason = integrityFailure([{ code: CredentialParsingError.IntegrityFail }]);
		expect(reason).not.toBeNull();
	});

	it('ignores unrelated warnings', () => {
		expect(integrityFailure([{ code: CredentialParsingError.NotFound }])).toBeNull();
	});

	it('accepts when there are no warnings at all', () => {
		expect(integrityFailure([])).toBeNull();
		expect(integrityFailure(undefined)).toBeNull();
	});
});

describe('declaredVct', () => {
	it('reads the vct from parsed SD-JWT metadata', () => {
		expect(declaredVct({ vct: 'urn:eudi:pid:1' })).toBe('urn:eudi:pid:1');
	});

	it('returns undefined for a format that carries none', () => {
		// The mdoc arm of the parsed-metadata union has no vct; that is not a
		// mismatch, it is nothing to compare.
		expect(declaredVct({ doctype: 'org.iso.18013.5.1.mDL' })).toBeUndefined();
		expect(declaredVct({ vct: '' })).toBeUndefined();
		expect(declaredVct(undefined)).toBeUndefined();
		expect(declaredVct(null)).toBeUndefined();
	});
});
