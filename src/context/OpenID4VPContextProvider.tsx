import React, { useState, useContext, useCallback } from 'react';
import { useOpenID4VP } from '../lib/services/OpenID4VP/OpenID4VP';
import OpenID4VPContext from './OpenID4VPContext';
import GenericConsentPopup from '@/components/Popups/GenericConsentPopup';
import SessionContext from './SessionContext';

export const OpenID4VPContextProvider = ({ children }: React.PropsWithChildren) => {
	const { isLoggedIn } = useContext<any>(SessionContext);

	const [popupConsentState, setPopupConsentState] = useState({
		isOpen: false,
		options: null,
		resolve: (value: unknown) => {},
		reject: () => {},
	});

	const showPopupConsent = useCallback(
		(options): Promise<boolean> =>
			new Promise((resolve, reject) => {
				setPopupConsentState({
					isOpen: true,
					options,
					resolve,
					reject,
				});
			}),
		[],
	);

	const hidePopupConsent = useCallback(() => {
		setPopupConsentState((prevState) => ({
			...prevState,
			isOpen: false,
		}));
	}, [setPopupConsentState]);

	const showTransactionDataConsentPopup = useCallback(
		async (options: Record<string, unknown>): Promise<boolean> => {
			return showPopupConsent(options);
		},
		[showPopupConsent],
	);

	const openID4VP = useOpenID4VP({ showTransactionDataConsentPopup });

	return (
		<OpenID4VPContext.Provider value={{ openID4VP, showTransactionDataConsentPopup }}>
			{children}
			{isLoggedIn && (
				<>
					<GenericConsentPopup
						popupConsentState={popupConsentState}
						setPopupConsentState={setPopupConsentState}
						showConsentPopup={showPopupConsent}
						hidePopupConsent={hidePopupConsent}
					/>
				</>
			)}
		</OpenID4VPContext.Provider>
	);
};
