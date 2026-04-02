import React, { useState, useCallback, useContext } from "react";
import { useOpenID4VCI } from "../lib/services/OpenID4VCI/OpenID4VCI";
import OpenID4VCIContext from "./OpenID4VCIContext";
import IssuanceConsentPopup from "@/components/Popups/IssuanceConsentPopup";
import SessionContext from "./SessionContext";
import { useOpenID4VCIClientStateRepository } from "@/lib/services/OpenID4VCIClientStateRepository";
import useErrorDialog from "@/hooks/useErrorDialog";

export const OpenID4VCIContextProvider = ({ children }: React.PropsWithChildren) => {

	const { isLoggedIn } = useContext(SessionContext);
	const openID4VCIClientStateRepository = useOpenID4VCIClientStateRepository();
	const { isInitialized } = openID4VCIClientStateRepository;

	const [popupConsentState, setPopupConsentState] = useState({
		isOpen: false,
		options: null,
		resolve: (value: unknown) => { },
		reject: () => { },
	});

	const showPopupConsent = useCallback((options): Promise<boolean> =>
		new Promise((resolve, reject) => {
			setPopupConsentState({
				isOpen: true,
				options,
				resolve,
				reject,
			});
		}), []);

	const hidePopupConsent = useCallback(() => {
		setPopupConsentState((prevState) => ({
			...prevState,
			isOpen: false,
		}));
	}, [setPopupConsentState]);

	const { displayError } = useErrorDialog();

	/**
	 * Show a message popup - routes to error dialog for errors,
	 * success messages are handled by the notification system.
	 * Note: Currently only used for error messages in OID4VCI flow.
	 * A centralized popup/message hook may replace this later.
	 */
	const showMessagePopup = useCallback((message: { title: string, description: string }, type: 'error' | 'success' = 'error') => {
		if (type === 'error') {
			displayError(message);
		}
		// Success messages are handled by the notification system (notify("newCredential"))
	}, [displayError]);

	const errorCallback = (title: string, msg: string) => {
		throw new Error("Not implemented");
	}

	const openID4VCI = useOpenID4VCI({ errorCallback, showPopupConsent, showMessagePopup, openID4VCIClientStateRepository });

	if (isLoggedIn && isInitialized && !isInitialized()) {
		return <></>
	}
	return (
		<OpenID4VCIContext.Provider value={{ openID4VCI }}>
			{children}
			{isLoggedIn && (
				<IssuanceConsentPopup popupConsentState={popupConsentState} setPopupConsentState={setPopupConsentState} showConsentPopup={showPopupConsent} hidePopupConsent={hidePopupConsent} />
			)}
		</OpenID4VCIContext.Provider>
	);
}
