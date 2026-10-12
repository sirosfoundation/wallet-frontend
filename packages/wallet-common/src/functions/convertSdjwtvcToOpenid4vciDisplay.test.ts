import { describe, expect, it } from 'vitest';
import type { TypeDisplayEntry } from '../schemas/SdJwtVcTypeMetadataSchema';
import { convertSdjwtvcToOpenid4vciDisplay } from './convertSdjwtvcToOpenid4vciDisplay';

// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
describe('convertSdjwtvcToOpenid4vciDisplay (CredentialConfigurationSupported.display)', () => {
	it('returns undefined for empty input', () => {
		expect(convertSdjwtvcToOpenid4vciDisplay(undefined)).toBeUndefined();
		expect(convertSdjwtvcToOpenid4vciDisplay([])).toBeUndefined();
	});

	it('maps name/description/locale', () => {
		const input: TypeDisplayEntry[] = [
			{ locale: 'en', name: 'EHIC', description: 'European Health Insurance Card' },
			{ locale: 'el', name: 'ΕΚΑΑ', description: 'Ευρωπαϊκή Κάρτα Ασφάλισης Ασθενείας' },
		];

		// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
		const out = convertSdjwtvcToOpenid4vciDisplay(input)!;

		expect(out).toEqual([
			{
				locale: 'en',
				name: 'EHIC',
				description: 'European Health Insurance Card',
			},
			{
				locale: 'el',
				name: 'ΕΚΑΑ',
				description: 'Ευρωπαϊκή Κάρτα Ασφάλισης Ασθενείας',
			},
		]);
	});

	it('maps rendering.simple colors, background image and logo; ignores svg_templates', () => {
		const input: TypeDisplayEntry[] = [
			{
				locale: 'en',
				name: 'EHIC',
				description: 'desc',
				rendering: {
					simple: {
						background_color: '#fff',
						text_color: '#000',
						background_image: { uri: 'https://example.com/bg.png' },
						logo: { uri: 'https://example.com/logo.png', alt_text: 'Logo' },
					},
					// should be ignored
					svg_templates: [{ uri: 'https://example.com/template.svg' }],
				},
			},
		];

		// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
		const out = convertSdjwtvcToOpenid4vciDisplay(input)!;

		expect(out).toEqual([
			{
				locale: 'en',
				name: 'EHIC',
				description: 'desc',
				background_color: '#fff',
				text_color: '#000',
				background_image: { uri: 'https://example.com/bg.png' },
				logo: { uri: 'https://example.com/logo.png', alt_text: 'Logo' },
			},
		]);
	});

	it('does not set background_image/logo if simple is missing (even if svg_templates exist)', () => {
		const input: TypeDisplayEntry[] = [
			{
				locale: 'en',
				name: 'EHIC',
				rendering: {
					// ignored
					svg_templates: [{ uri: 'https://example.com/template.svg' }],
				},
			},
		];

		// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
		const out = convertSdjwtvcToOpenid4vciDisplay(input)!;

		expect(out).toEqual([{ locale: 'en', name: 'EHIC' }]);
	});
});
