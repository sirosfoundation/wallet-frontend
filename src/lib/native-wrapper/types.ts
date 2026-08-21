/**
 * Display properties for credential UI in Android's credential selector
 */
export interface CredentialDisplayProperties {
	title: string;
	subtitle?: string;
	icon?: string;
}

/**
 * Claim info with value and localized labels
 */
export type SdJwtClaim = {
	path: string;
	value: unknown;
	display: Record<string, string>;
};


/**
 * SD-JWT credential entry for OpenId4VpRegistry
 */
export interface SdJwtRegistryEntry {
	format: "sd-jwt";
	id: string;
	verifiableCredentialType: string;
	claims: SdJwtClaim[];
	display: CredentialDisplayProperties;
}

export type MdocField = {
	namespace: string;
	identifier: string;
	value: unknown;
	display: Record<string, string>;
}

/**
 * mDOC credential entry for OpenId4VpRegistry
 */
export interface MdocRegistryEntry {
	format: "mdoc";
	id: string;
	docType: string;
	fields: MdocField[];
	display: CredentialDisplayProperties;
}

export type CredentialRegistryEntry = SdJwtRegistryEntry | MdocRegistryEntry;
