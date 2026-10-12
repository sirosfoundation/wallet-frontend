import type React from 'react';
import { useCallback, useContext, useState } from 'react';
import GenericConsentPopup from '@/components/Popups/GenericConsentPopup';
import OpenID4VPContext from './OpenID4VPContext';
import SessionContext from './SessionContext';

export const OpenID4VPContextProvider = ({ children }: React.PropsWithChildren) => {
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	const { isLoggedIn } = useContext<any>(SessionContext);

	const [popupConsentState, setPopupConsentState] = useState({
		isOpen: false,
		options: null,
		// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/correctness/noUnusedFunctionParameters: baseline: pre-existing debt. should be fixed
		resolve: (value: unknown) => {},
		// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const hidePopupConsent = useCallback(() => {
		setPopupConsentState((prevState) => ({
			...prevState,
			isOpen: false,
		}));
	}, [setPopupConsentState]);

	const showTransactionDataConsentPopup = useCallback(
		// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
		async (options: Record<string, unknown>): Promise<boolean> => {
			return showPopupConsent(options);
		},
		[showPopupConsent],
	);

	return (
		<OpenID4VPContext.Provider value={{ showTransactionDataConsentPopup }}>
			{children}
			{isLoggedIn && (
				// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
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
