import { describe, it, expect } from 'vitest';
import { LEGACY_SECRET_MEMBERS, carriesLegacySecretMember } from './legacySecretMembers';

describe('LEGACY_SECRET_MEMBERS', () => {
	it('is exactly the five names the Kotlin SDK refuses (siros-sdk-kotlin #337)', () => {
		expect([...LEGACY_SECRET_MEMBERS]).toEqual([
			'org.siros.secret_seed',
			'org.siros.holder_commitments',
			'org.siros.psc',
			'holder_commitments',
			'secret_members',
		]);
	});
});

describe('carriesLegacySecretMember', () => {
	it.each(LEGACY_SECRET_MEMBERS)('is true for %s, whatever its value', (member) => {
		for (const value of [null, {}, [], 'x', 0, false, { ns: 'ab' }]) {
			expect(carriesLegacySecretMember({ display: [], [member]: value })).toBe(true);
		}
	});

	it.each([
		['no members', {}],
		['display and claims only', { display: [], claims: [] }],
		['another extension', { 'org.example.extension': {} }],
		['a similar but different name', { 'org.siros.secret_seed.v2': {}, 'org.siros.psc_x': {}, secret_member: {} }],
		['a legacy name only nested', { display: [{ 'org.siros.secret_seed': 'x' }], extra: { psc: {}, holder_commitments: [] } }],
		['a legacy name in another case', { 'ORG.SIROS.SECRET_SEED': {} }],
	])('is false for %s', (_label, metadata) => {
		expect(carriesLegacySecretMember(metadata)).toBe(false);
	});

	it.each([['null', null], ['undefined', undefined], ['a string', 'org.siros.secret_seed'], ['an array', ['org.siros.secret_seed']], ['a number', 7]])(
		'is false when credential_metadata is %s',
		(_label, metadata) => {
			expect(carriesLegacySecretMember(metadata)).toBe(false);
		},
	);

	it('does not look inside an array, even one with an own member of that name', () => {
		expect(carriesLegacySecretMember(Object.assign([], { 'org.siros.secret_seed': {} }))).toBe(false);
	});

	it('does not see an inherited member', () => {
		expect(carriesLegacySecretMember(Object.create({ 'org.siros.secret_seed': {} }))).toBe(false);
	});
});
