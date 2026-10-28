import { describe, it, expect } from 'vitest';
import { getValueByPath, resolveClaimLabel, resolveCredentialPresentationRequest } from './utils';
import type { ConformantCredentials } from './types';
import type { OID4VPVerifierInfo } from '@/lib/openid-flow/types/OID4VPTypes';


describe('getValueByPath', () => {
	it('reads a simple nested value', () => {
		expect(getValueByPath(['a', 'b'], { a: { b: 1 } })).toBe(1);
	});

	it('returns undefined for a missing key', () => {
		expect(getValueByPath(['a', 'x'], { a: { b: 1 } })).toBeUndefined();
	});

	it('returns undefined for an empty path', () => {
		expect(getValueByPath([], { a: 1 })).toBeUndefined();
	});

	it('maps over all values for a null segment', () => {
		const obj = { a: { x: { c: 1 }, y: { c: 2 } } };
		expect(getValueByPath(['a', null, 'c'], obj)).toEqual([1, 2]);
	});

	it('filters out children that lack the trailing path on a null segment', () => {
		const obj = { a: { x: { c: 1 }, y: { d: 2 } } };
		expect(getValueByPath(['a', null, 'c'], obj)).toEqual([1]);
	});

	it('collapses an empty-object result to undefined', () => {
		expect(getValueByPath(['a'], { a: {} })).toBeUndefined();
	});

	it('preserves falsy primitive values', () => {
		expect(getValueByPath(['a'], { a: 0 })).toBe(0);
		expect(getValueByPath(['a'], { a: false })).toBe(false);
		expect(getValueByPath(['a'], { a: '' })).toBe('');
	});

	it('returns undefined when a mid-path value is not an object', () => {
		expect(getValueByPath(['a', 'b'], { a: 5 })).toBeUndefined();
	});

	it('supports numeric (array index) segments', () => {
		expect(getValueByPath(['a', 1], { a: ['x', 'y'] })).toBe('y');
	});
});

describe('resolveClaimLabel', () => {
	const claims = [
		{
			path: ['age_equal_or_over', '18'],
			display: [
				{ locale: 'en-US', label: 'Age over 18' },
				{ locale: 'sv-SE', label: 'Ålder över 18' },
			],
		},
		{
			path: ['family_name'],
			display: [{ locale: 'en-US', label: 'Last name' }],
		},
		{
			path: ['no_display'],
		},
	];

	it('returns the label for the first matching preferred language', () => {
		expect(
			resolveClaimLabel(claims, { path: ['age_equal_or_over', '18'] }, ['sv-SE', 'en-US']),
		).toBe('Ålder över 18');
	});

	it('falls back to the first display when no preferred locale matches', () => {
		expect(
			resolveClaimLabel(claims, { path: ['family_name'] }, ['fr-FR']),
		).toBe('Last name');
	});

	it('falls back to field.name when the claim has no display', () => {
		expect(
			resolveClaimLabel(claims, { name: 'Custom', path: ['no_display'] }, ['en-US']),
		).toBe('Custom');
	});

	it('falls back to a joined path when no claim matches and no name is given', () => {
		expect(
			resolveClaimLabel(claims, { path: ['address', 'locality'] }, ['en-US']),
		).toBe('address › locality');
	});

	it('returns "Unknown" when nothing resolves', () => {
		expect(resolveClaimLabel(claims, {}, ['en-US'])).toBe('Unknown');
	});

	it('matches claim paths that contain null segments against the field path', () => {
		const withNull = [
			{ path: ['nationalities', null], display: [{ locale: 'en-US', label: 'Nationality' }] },
		];
		expect(
			resolveClaimLabel(withNull, { path: ['nationalities'] }, ['en-US']),
		).toBe('Nationality');
	});
});

const verifierInfo = {
	name: 'sandbox',
	domain: 'verifier.dev.eduwallet.nl',
	purpose: 'Proeftuin requires the credential content',
} as OID4VPVerifierInfo;

const conformant: ConformantCredentials = new Map([
	['eduID', {
		credentials: [7],
		requestedFields: [{ name: 'email', path: ['email'] }],
	}],
]);

describe('resolveCredentialPresentationRequest without a DCQL query', () => {
	/**
	 * The http_proxy flow matches in wallet-common and returns only the
	 * conformant map -- no dcqlQuery. Dereferencing it here threw
	 * "Cannot read properties of undefined (reading 'credentials')", which
	 * surfaced to the user as a credential selection error.
	 */
	it('falls back to the conformant map for the query ids', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			undefined,
			conformant,
			[],
			['en'],
		);

		expect(request.queries).toHaveLength(1);
		expect(request.queries[0].id).toBe('eduID');
		// No credentials were supplied, so there is nothing to match against;
		// the point is that the query id was recovered at all.
		expect(request.queries[0].matches).toEqual([]);
	});

	it('still produces a default credential set', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			undefined,
			conformant,
			[],
			['en'],
		);

		expect(request.sets).toEqual([{ required: true, options: [['eduID']] }]);
	});

	it('prefers the query when one is supplied', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			{
				credentials: [{ id: 'eduID', format: 'dc+sd-jwt' }],
				credential_sets: [{ options: [['eduID']], purpose: 'Proeftuin requires the credential content' }],
			} as never,
			conformant,
			[],
			['en'],
		);

		expect(request.queries[0].id).toBe('eduID');
		expect(request.sets[0].purpose).toBe('Proeftuin requires the credential content');
	});
});
