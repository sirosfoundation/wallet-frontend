import React, { createContext } from "react";

export type OpenID4VPContextValue = {
	showTransactionDataConsentPopup?: (options: Record<string, unknown>) => Promise<boolean>;
};

const OpenID4VPContext: React.Context<OpenID4VPContextValue> = createContext({});

export default OpenID4VPContext;
