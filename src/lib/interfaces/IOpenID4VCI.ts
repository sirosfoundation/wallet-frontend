import { CredentialConfigurationSupported } from "wallet-common";


export interface IOpenID4VCI {
	handleCredentialOffer(credentialOfferURL: string): Promise<{ credentialIssuer: string, selectedCredentialConfigurationId: string; issuer_state?: string; txCode?: { inputMode?: string; length?: number; description?: string; }; preAuthorizedCode?: string; }>;
	getAvailableCredentialConfigurations(credentialIssuerIdentifier: string): Promise<Record<string, CredentialConfigurationSupported>>;
	generateAuthorizationRequest(credentialIssuerIdentifier: string, credentialConfigurationId: string, issuer_state?: string): Promise<{ url?: string }>;
	handleAuthorizationResponse(url: string, dpopNonceHeader?: string): Promise<{ credentials?: Array<{ credential: string }>; credentialIssuerIdentifier?: string; credentialConfigurationId?: string }>;
	requestCredentialsWithPreAuthorization(credentialIssuer: string, selectedCredentialConfigurationId: string, preAuthorizedCode: string, txCodeInput?: string): Promise<{ credentials?: Array<{ credential: string }>; credentialIssuerIdentifier?: string; credentialConfigurationId?: string }>;
}
