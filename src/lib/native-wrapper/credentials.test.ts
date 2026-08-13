import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareCredentialsForNativeWrapper } from './credentials';
import {
	shapeCredential,
	extractAvailableClaims,
} from '@/services/CredentialMatchingService';
import { getElementPropValue } from '@/util';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { getCredentialType } from '../utils/getCredentialType';

vi.mock('@/services/CredentialMatchingService', () => ({
	shapeCredential: vi.fn(),
	extractAvailableClaims: vi.fn(),
}));

vi.mock('@/components/QueryableList/CredentialsDisplayUtils', () => ({
	getCredentialType: vi.fn(),
}));

vi.mock('@/util', () => ({
	getElementPropValue: vi.fn(),
}));

vi.mock('@/lib/utils/getCredentialType', () => ({
	getCredentialType: vi.fn(),
}))

const mockShapeCredential = vi.mocked(shapeCredential);
const mockExtractAvailableClaims = vi.mocked(extractAvailableClaims);
const mockGetCredentialType = vi.mocked(getCredentialType);
const mockGetElementPropValue = vi.mocked(getElementPropValue);

/**
 * Build a minimal ExtendedVcEntity with just the fields the SUT reads.
 */
function makeCredential(
	overrides: {
		batchId?: number;
		nameFn?: (langs: string[]) => Promise<string>;
		issuerName?: string;
		typeMetadataClaims?: {
			path: string[];
			display: { locale: string; label: string }[];
		}[];
		signedClaims?: Record<string, unknown>;
	} = {},
): ExtendedVcEntity {
	return {
		batchId: overrides.batchId ?? 1,
		parsedCredential: {
			metadata: {
				credential: {
					name: overrides.nameFn,
					TypeMetadata: overrides.typeMetadataClaims
						? { claims: overrides.typeMetadataClaims }
						: undefined,
				},
				issuer: overrides.issuerName
					? { name: overrides.issuerName }
					: undefined,
			},
			signedClaims: overrides.signedClaims ?? {},
		},
	} as unknown as ExtendedVcEntity;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Sensible defaults; individual tests override as needed.
	mockGetCredentialType.mockReturnValue('Fallback Type');
	mockExtractAvailableClaims.mockReturnValue([]);
	mockGetElementPropValue.mockImplementation(
		(_claims, path) => `value:${path}`,
	);
});

describe('prepareCredentialsForNativeWrapper', () => {
	it('returns an empty array for empty input', async () => {
		await expect(prepareCredentialsForNativeWrapper([])).resolves.toEqual([]);
	});

	it('skips credentials that cannot be shaped', async () => {
		mockShapeCredential.mockReturnValue(null);

		const result = await prepareCredentialsForNativeWrapper([makeCredential()]);

		expect(result).toEqual([]);
	});

	describe('mdoc entries', () => {
		beforeEach(() => {
			mockShapeCredential.mockReturnValue({
				credential_format: 'mso_mdoc',
				doctype: 'org.iso.18013.5.1.mDL',
				namespaces: {
					'org.iso.18013.5.1': {
						family_name: 'Doe',
						age_over_18: true,
					},
				},
			} as any);
		});

		it('maps namespaces to prefixed claim paths and uses batchId as id', async () => {
			const credential = makeCredential({ batchId: 42 });

			const [entry] = await prepareCredentialsForNativeWrapper([credential]);

			expect(entry).toMatchObject({
				format: 'mdoc',
				id: '42',
				docType: 'org.iso.18013.5.1.mDL',
			});
			expect(entry.claims).toEqual([
				{ path: 'org.iso.18013.5.1.family_name', value: 'Doe', display: {} },
				{ path: 'org.iso.18013.5.1.age_over_18', value: true, display: {} },
			]);
		});

		it('resolves display labels by element name and by full path', async () => {
			const credential = makeCredential({
				typeMetadataClaims: [
					// matched by bare element name
					{
						path: ['family_name'],
						display: [{ locale: 'en-US', label: 'Family Name' }],
					},
					// matched by full namespaced path
					{
						path: ['org.iso.18013.5.1.age_over_18'],
						display: [{ locale: 'en-US', label: 'Over 18' }],
					},
				],
			});

			const [entry] = await prepareCredentialsForNativeWrapper([credential]);

			expect(entry.claims).toEqual([
				{
					path: 'org.iso.18013.5.1.family_name',
					value: 'Doe',
					display: { 'en-US': 'Family Name' },
				},
				{
					path: 'org.iso.18013.5.1.age_over_18',
					value: true,
					display: { 'en-US': 'Over 18' },
				},
			]);
		});
	});

	describe('sd-jwt entries', () => {
		beforeEach(() => {
			mockShapeCredential.mockReturnValue({
				credential_format: 'dc+sd-jwt',
				vct: 'https://example.com/id-card',
			} as any);
		});

		it('maps available claims and uses batchId as id and vct as type', async () => {
			mockExtractAvailableClaims.mockReturnValue([
				'given_name',
				'address.locality',
			]);
			const credential = makeCredential({ batchId: 7 });

			const [entry] = await prepareCredentialsForNativeWrapper([credential]);

			expect(entry).toMatchObject({
				format: 'sd-jwt',
				id: '7',
				verifiableCredentialType: 'https://example.com/id-card',
			});
			expect(entry.claims).toEqual([
				{ path: 'given_name', value: 'value:given_name', display: {} },
				{
					path: 'address.locality',
					value: 'value:address.locality',
					display: {},
				},
			]);
		});

		it('filters out reserved root claims', async () => {
			mockExtractAvailableClaims.mockReturnValue([
				'vct',
				'iss',
				'vct#integrity',
				'given_name',
				'address.country', // root "address" is not reserved -> kept
			]);

			const [entry] = await prepareCredentialsForNativeWrapper([
				makeCredential(),
			]);

			expect(entry.claims.map((c) => c.path)).toEqual([
				'given_name',
				'address.country',
			]);
		});

		it('attaches localized display labels from TypeMetadata', async () => {
			mockExtractAvailableClaims.mockReturnValue(['given_name']);
			const credential = makeCredential({
				typeMetadataClaims: [
					{
						path: ['given_name'],
						display: [
							{ locale: 'en-US', label: 'First name' },
							{ locale: 'sv-SE', label: 'Förnamn' },
						],
					},
				],
			});

			const [entry] = await prepareCredentialsForNativeWrapper([credential]);

			expect(entry.claims[0].display).toEqual({
				'en-US': 'First name',
				'sv-SE': 'Förnamn',
			});
		});
	});

	describe('display info', () => {
		beforeEach(() => {
			mockShapeCredential.mockReturnValue({
				credential_format: 'dc+sd-jwt',
				vct: 'https://example.com/id-card',
			} as any);
		});

		it('uses the localized credential name and passes preferred languages through', async () => {
			const nameFn = vi.fn().mockResolvedValue('Localized Name');
			const credential = makeCredential({ nameFn, issuerName: 'Acme Corp' });

			const [entry] = await prepareCredentialsForNativeWrapper(
				[credential],
				['sv-SE'],
			);

			expect(nameFn).toHaveBeenCalledWith(['sv-SE']);
			expect(entry.display).toEqual({
				title: 'Localized Name',
				subtitle: 'Issued by Acme Corp',
			});
		});

		it('falls back to getCredentialType when no name function is present', async () => {
			mockGetCredentialType.mockReturnValue('Identity Card');

			const [entry] = await prepareCredentialsForNativeWrapper([
				makeCredential(),
			]);

			expect(entry.display.title).toBe('Identity Card');
		});

		it('falls back to "Credential" when no name and no type are available', async () => {
			mockGetCredentialType.mockReturnValue('');

			const [entry] = await prepareCredentialsForNativeWrapper([
				makeCredential(),
			]);

			expect(entry.display.title).toBe('Credential');
		});

		it('omits the subtitle when the issuer name is missing', async () => {
			const [entry] = await prepareCredentialsForNativeWrapper([
				makeCredential(),
			]);

			expect(entry.display.subtitle).toBeUndefined();
		});
	});

	it('processes multiple credentials and skips only the unshapeable ones', async () => {
		mockShapeCredential
			.mockReturnValueOnce({
				credential_format: 'dc+sd-jwt',
				vct: 'https://example.com/a',
			} as any)
			.mockReturnValueOnce(null)
			.mockReturnValueOnce({
				credential_format: 'mso_mdoc',
				doctype: 'doc.type',
				namespaces: {},
			} as any);

		const result = await prepareCredentialsForNativeWrapper([
			makeCredential({ batchId: 1 }),
			makeCredential({ batchId: 2 }),
			makeCredential({ batchId: 3 }),
		]);

		expect(result.map((e) => e.id)).toEqual(['1', '3']);
		expect(result.map((e) => e.format)).toEqual(['sd-jwt', 'mdoc']);
	});
});
