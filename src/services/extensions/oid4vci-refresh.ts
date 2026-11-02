import type { JWK } from 'jose';

/**
 * An org.siros.oid4vci.refresh entry (privatedata-spec §6.1.7).
 */
export type OID4VCIRefreshEntry = {
	refreshToken: string;
	dpopJwk?: JWK;
	dpopKid?: string;
	credentialIssuerIdentifier: string;
	credentialConfigurationId: string;
};

/**
 * Parse an entry value. Anything malformed is treated as no entry.
 */
export function parseOID4VCIRefreshEntry(value: string | undefined): OID4VCIRefreshEntry | undefined {
	if (!value) return undefined;

	let entry: Record<string, unknown>;
	try {
		entry = JSON.parse(value);
	} catch {
		return undefined;
	}

	if (typeof entry !== 'object' || entry === null) return undefined;

	const { refreshToken, dpopJwk, dpopKid, credentialIssuerIdentifier, credentialConfigurationId } = entry;
	if (
		typeof refreshToken !== 'string' ||
		typeof credentialIssuerIdentifier !== 'string' ||
		typeof credentialConfigurationId !== 'string' ||
		(dpopJwk !== undefined && (typeof dpopJwk !== 'object' || dpopJwk === null)) ||
		(dpopKid !== undefined && typeof dpopKid !== 'string') ||
		(dpopJwk !== undefined && dpopKid !== undefined)
	) return undefined;

	return {
		refreshToken,
		dpopJwk: dpopJwk as JWK | undefined,
		dpopKid: dpopKid as string | undefined,
		credentialIssuerIdentifier,
		credentialConfigurationId,
	};
}

/**
 * Serialize an entry into the stored value.
 */
export function serializeOID4VCIRefreshEntry(entry: OID4VCIRefreshEntry): string {
	return JSON.stringify(entry);
}
