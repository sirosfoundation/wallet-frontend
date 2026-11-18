import { describe, it, expect } from 'vitest';
import { frontedRpDisplay, type VerifierInfoElement } from './fronted-relying-party';

const dataset = (overrides: Partial<{
	srvDescription: Array<{ lang: string; content: string }>;
	purpose: Array<{ lang: string; content: string }>;
	policyURI: string;
	identifier: Array<{ type: string; identifier: string }>;
}> = {}) => ({
	srvDescription: [{ lang: 'sv', content: 'WRPAC-drillens frontade part' }],
	purpose: [{ lang: 'sv', content: 'Verifiera identitet' }],
	policyURI: 'https://fronted-rp.example.test/privacy',
	identifier: [{ type: 'ntr', identifier: 'NTRSE-WRPAC-FRONTED' }],
	...overrides,
});

const members = (data: unknown, format = 'registrar_dataset'): VerifierInfoElement[] => [
	{ format, data },
];

describe('frontedRpDisplay', () => {
	it('extracts the srvDescription in the requested language', () => {
		const result = frontedRpDisplay(members(dataset()), 'sv');
		expect(result?.name).toBe('WRPAC-drillens frontade part');
		expect(result?.purpose).toBe('Verifiera identitet');
		expect(result?.policyURI).toBe('https://fronted-rp.example.test/privacy');
		expect(result?.identifier).toBe('NTRSE-WRPAC-FRONTED');
	});

	it('falls back to English, then the first entry', () => {
		const multi = members(dataset({
			srvDescription: [
				{ lang: 'sv', content: 'sv-name' },
				{ lang: 'en', content: 'en-name' },
			],
		}));
		expect(frontedRpDisplay(multi, 'fr')?.name).toBe('en-name');
		expect(frontedRpDisplay(multi, 'sv')?.name).toBe('sv-name');
		expect(frontedRpDisplay(members(dataset({
			srvDescription: [{ lang: 'de', content: 'de-only' }],
		})), 'en')?.name).toBe('de-only');
	});

	it('falls back to the NTR identifier when no srvDescription exists', () => {
		const noDesc = members(dataset({ srvDescription: undefined }));
		expect(frontedRpDisplay(noDesc, 'sv')?.name).toBe('NTRSE-WRPAC-FRONTED');
	});

	it('returns null when the members are empty, absent, or carry no display data', () => {
		expect(frontedRpDisplay(null, 'sv')).toBeNull();
		expect(frontedRpDisplay([], 'sv')).toBeNull();
		expect(frontedRpDisplay(members({}), 'sv')).toBeNull();
		expect(frontedRpDisplay([{ format: 'other_format' }], 'sv')).toBeNull();
		expect(frontedRpDisplay(members({ srvDescription: [], identifier: [] }), 'sv')).toBeNull();
	});
});
