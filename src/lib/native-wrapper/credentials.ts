import { getCredentialType } from '@/components/QueryableList/CredentialsDisplayUtils';
import { ExtendedVcEntity } from '@/context/CredentialsContext';
import { CredentialDisplayProperties, CredentialRegistryEntry, ClaimEntry } from './types';
import { shapeCredential, extractAvailableClaims } from '@/services/CredentialMatchingService';
import { getElementPropValue } from '@/util';

const REGISTRY_RESERVED_CLAIMS = new Set([
	'iss',
	'iat',
	'exp',
	'nbf',
	'vct',
	'cnf',
	'jti',
	'status',
	'arf',
	'vct#integrity',
	'trust_anchor',
]);

export async function prepareCredentialsForNativeWrapper(
	credentials: ExtendedVcEntity[],
	preferredLangs: string[] = ['en-US'],
): Promise<CredentialRegistryEntry[]> {
	const entries: CredentialRegistryEntry[] = [];

	for (const credential of credentials) {
		const shaped = shapeCredential(credential);
		if (!shaped) continue;

		// Get display info
		const credentialNameFn =
			credential.parsedCredential?.metadata?.credential?.name;
		const title = credentialNameFn
			? await credentialNameFn(preferredLangs)
			: getCredentialType(credential.parsedCredential) || 'Credential';
		const issuerName = credential.parsedCredential?.metadata?.issuer?.name;

		const display: CredentialDisplayProperties = {
			title: title ?? 'Credential',
			subtitle: issuerName ? `Issued by ${issuerName}` : undefined,
		};

		const claimMetadata =
			credential.parsedCredential?.metadata?.credential?.TypeMetadata?.claims ?? [];

		// Build metadata lookup: pathKey -> display array
		const metadataByPath = new Map<string, { locale: string; label: string }[]>();
		for (const claim of claimMetadata) {
			if (Array.isArray(claim.path) && Array.isArray(claim.display)) {
				metadataByPath.set(claim.path.join('.'), claim.display);
			}
		}

		if (shaped.credential_format === 'mso_mdoc') {
			const claims: ClaimEntry[] = [];

			for (const [ns, elements] of Object.entries(shaped.namespaces)) {
				for (const [element, value] of Object.entries(elements as object)) {
					const pathKey = `${ns}.${element}`;
					const displayLabels: Record<string, string> = {};
					const meta = metadataByPath.get(element) ?? metadataByPath.get(pathKey);
					if (meta) {
						for (const d of meta) {
							if (d.locale && d.label) {
								displayLabels[d.locale] = d.label;
							}
						}
					}
					claims.push({ path: pathKey, value, display: displayLabels });
				}
			}

			entries.push({
				format: 'mdoc',
				id: String(credential.batchId),
				docType: shaped.doctype,
				claims,
				display,
			});
		} else {
			// SD-JWT
			const signedClaims = credential.parsedCredential?.signedClaims ?? {};

			const availableClaims = extractAvailableClaims(credential).filter((claim) => {
				const rootKey = claim.split('.')[0];
				return !REGISTRY_RESERVED_CLAIMS.has(rootKey);
			});

			const claims: ClaimEntry[] = [];

			for (const claimPath of availableClaims) {
				const value = getElementPropValue(signedClaims, claimPath);
				const displayLabels: Record<string, string> = {};
				const meta = metadataByPath.get(claimPath);
				if (meta) {
					for (const d of meta) {
						if (d.locale && d.label) {
							displayLabels[d.locale] = d.label;
						}
					}
				}
				claims.push({ path: claimPath, value, display: displayLabels });
			}

			entries.push({
				format: 'sd-jwt',
				id: String(credential.batchId),
				verifiableCredentialType: shaped.vct,
				claims,
				display,
			});
		}
	}

	return entries;
}
