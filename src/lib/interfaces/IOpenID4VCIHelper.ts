import type { OpenidAuthorizationServerMetadata, OpenidCredentialIssuerMetadata } from "wallet-common";

export interface IOpenID4VCIHelper {
	getClientId(credentialIssuerIdentifier: string): Promise<{ client_id: string } | null>;
	getAuthorizationServerMetadata(credentialIssuerIdentifier: string): Promise<{ authzServerMetadata: OpenidAuthorizationServerMetadata } | null>;
	getCredentialIssuerMetadata(credentialIssuerIdentifier: string, useCache?: boolean): Promise<{ metadata: OpenidCredentialIssuerMetadata } | null>;
	fetchIssuerMetadataAndCertificates(getIssuers: () => Promise<Record<string, unknown>[]>, shouldUseCache: boolean, onIssuerMetadataResolved?: (issuerIdentifier: string, metadata: OpenidCredentialIssuerMetadata) => void): Promise<void>;
}
