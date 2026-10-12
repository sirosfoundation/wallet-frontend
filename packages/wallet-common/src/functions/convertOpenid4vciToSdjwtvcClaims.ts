import type { OpenIdClaim } from '../schemas';
import type { ClaimDisplayEntry, ClaimMetadataEntry } from '../schemas/SdJwtVcTypeMetadataSchema';

export function convertOpenid4vciToSdjwtvcClaims(
	metadataClaims?: OpenIdClaim[] | null,
): ClaimMetadataEntry[] {
	if (!metadataClaims?.length) return [];

	return metadataClaims
		.map<ClaimMetadataEntry | null>((claim) => {
			const normalizedDisplay: ClaimDisplayEntry[] = (claim.display ?? [])
				.filter(
					(d): d is { locale: string; name: string } =>
						typeof d?.locale === 'string' &&
						d.locale.trim().length > 0 &&
						typeof d?.name === 'string' &&
						d.name.trim().length > 0,
				)
				.map((d) => ({
					locale: d.locale.trim(),
					label: d.name.trim(),
				}));

			// preserve mandatory if present (true OR false), skip if undefined
			// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
			const mandatory = Object.hasOwn(claim, 'mandatory') ? (claim as any).mandatory : undefined;

			return {
				path: claim.path,
				...(normalizedDisplay.length > 0 ? { display: normalizedDisplay } : {}),
				...(mandatory !== undefined ? { mandatory } : {}),
			} as ClaimMetadataEntry;
		})
		.filter((e): e is ClaimMetadataEntry => e !== null);
}

// biome-ignore lint/complexity/noRedundantDefaultExport: baseline: pre-existing debt. should be fixed
export default convertOpenid4vciToSdjwtvcClaims;
