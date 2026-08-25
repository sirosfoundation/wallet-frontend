import { ExtendedVcEntity } from '@/context/CredentialsContext';
import {
	CredentialDisplayProperties,
	CredentialRegistryEntry,
	SdJwtClaim,
	SdJwtRegistryEntry,
	MdocRegistryEntry,
	MdocField,
} from './types';
import {
	shapeCredential,
	extractAvailableClaims,
} from '@/services/CredentialMatchingService';
import { getElementPropValue } from '@/util';
import { getCredentialType } from '../utils/getCredentialType';

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

/**
 * Prepare credentials for native wrapper consumption by shaping them into
 * a registry format.
 */
export async function prepareCredentialsForNativeWrapper(
	credentials: ExtendedVcEntity[],
	preferredLangs: string[] = ['en-US'],
): Promise<CredentialRegistryEntry[]> {
	const entries: CredentialRegistryEntry[] = [];

	for (const credential of credentials) {
		const shaped = shapeCredential(credential);
		if (!shaped) continue;

		const display = await getCredentialDisplayInfo(credential, preferredLangs);

		const metadataByPath = getMetadataByPath(credential);

		entries.push(
			(shaped.credential_format === 'mso_mdoc'
				? shapeMdocEntry
				: shapeJwtClaims)(credential, shaped, metadataByPath, display),
		);
	}

	return entries;
}

async function getCredentialDisplayInfo(
	credential: ExtendedVcEntity,
	preferredLangs: string[],
): Promise<CredentialDisplayProperties> {
	const credentialNameFn =
		credential.parsedCredential?.metadata?.credential?.name;
	const title = credentialNameFn
		? await credentialNameFn(preferredLangs)
		: getCredentialType(credential.parsedCredential) || 'Credential';
	const issuerName = getReadableIssuerName(
		credential.parsedCredential?.metadata?.issuer?.name,
	);

	return {
		title: title ?? 'Credential',
		subtitle: issuerName ? `Issued by ${issuerName}` : undefined,
	};
}

function getMetadataByPath(
	credential: ExtendedVcEntity,
): Map<string, { locale: string; label: string }[]> {
	const metadataByPath = new Map<string, { locale: string; label: string }[]>();
	const claimMetadata =
		credential.parsedCredential?.metadata?.credential?.TypeMetadata?.claims ??
		[];

	for (const claim of claimMetadata) {
		if (Array.isArray(claim.path) && Array.isArray(claim.display)) {
			metadataByPath.set(claim.path.join('.'), claim.display);
		}
	}

	return metadataByPath;
}

function shapeMdocEntry(
	credential: ExtendedVcEntity,
	shaped: any,
	metadataByPath: Map<string, { locale: string; label: string }[]>,
	display: CredentialDisplayProperties,
): MdocRegistryEntry {
	const fields: MdocField[] = [];

	for (const [namespace, elements] of Object.entries(shaped.namespaces)) {
		for (const [element, value] of Object.entries(elements as object)) {
			const identifier = element;
			const displayLabels: Record<string, string> = {};
			const meta = metadataByPath.get([namespace, identifier].join('.'));

			if (meta) {
				for (const d of meta) {
					if (d.locale && d.label) {
						displayLabels[d.locale] = d.label;
					}
				}
			}

			fields.push({ namespace, identifier, value, display: displayLabels });
		}
	}

	return {
		format: 'mdoc',
		id: String(credential.batchId),
		docType: shaped.doctype,
		fields,
		display,
	};
}

function shapeJwtClaims(
	credential: ExtendedVcEntity,
	shaped: any,
	metadataByPath: Map<string, { locale: string; label: string }[]>,
	display: CredentialDisplayProperties,
): SdJwtRegistryEntry {
	const signedClaims = credential.parsedCredential?.signedClaims ?? {};

	const availableClaims = extractAvailableClaims(credential).filter((claim) => {
		const rootKey = claim.split('.')[0];
		return !REGISTRY_RESERVED_CLAIMS.has(rootKey);
	});

	const claims: SdJwtClaim[] = [];

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

	return {
		format: 'sd-jwt',
		id: String(credential.batchId),
		verifiableCredentialType: shaped.vct,
		claims,
		display,
	};
}

/**
 * Extract a human-readable issuer name.
 */
function getReadableIssuerName(raw: string | undefined): string | undefined {
	if (!raw) return undefined;

	const attributes = raw.split(',').map((part) => part.trim());
	const findAttribute = (key: string) =>
		attributes
			.find((attr) => attr.toUpperCase().startsWith(`${key}=`))
			?.slice(key.length + 1)
			.trim();

	return findAttribute('O') || findAttribute('CN') || raw;
}
