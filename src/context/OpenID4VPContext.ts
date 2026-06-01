import React, { createContext } from "react";
import { IOpenID4VP } from "../lib/interfaces/IOpenID4VP";

export type CredentialSelectionPopupFn = (
	conformantCredentialsMap: Record<string, {
		credentials: number[];
		requestedFields: Array<{ name?: string; path?: string[] }>;
	}>,
	verifierDomainName: string,
	verifierPurpose: string,
) => Promise<Map<string, number>>;

export type OpenID4VPContextValue = {
	openID4VP: IOpenID4VP;
	showCredentialSelectionPopup?: CredentialSelectionPopupFn;
	showTransactionDataConsentPopup?: (options: Record<string, unknown>) => Promise<boolean>;
};

const OpenID4VPContext: React.Context<OpenID4VPContextValue> = createContext({
	openID4VP: null,
});

export default OpenID4VPContext;
