import React, { useContext, useEffect } from "react";
import { useLocalStorageKeystore } from "../services/LocalStorageKeystore";
import keystoreEvents from "../services/keystoreEvents";
import CredentialsContext from "@/context/CredentialsContext";
import { prepareCredentialsForNativeWrapper } from "@/lib/native-wrapper";
import { logger } from "@/logger";
import { OPENID4VCI_REDIRECT_URI } from "@/config";

declare global {
	interface Window {
		nativeWrapper?: NativeWrapper;
	}

	interface NativeWrapper {
		updateAllCredentials(credentials: string, callbackUrl?: string): void;
		sendDcApiResponse(response: string, error?: string): void;
		isKeystoreOpen(): Promise<boolean>;
		startScanPhysicalId?(): void;
	}
}

export const NativeWrapperProvider = ({
	children,
}: React.PropsWithChildren) => {
	const keystore = useLocalStorageKeystore(keystoreEvents);
	const { vcEntityList } = useContext(CredentialsContext);

	useEffect(() => {
		if (window.nativeWrapper) {
			window.nativeWrapper.isKeystoreOpen = async () => keystore.isOpen();
		}
	}, [keystore]);

	useEffect(() => {
		(async () => {
			if (!window.nativeWrapper) return;

			const registryEntries =
				await prepareCredentialsForNativeWrapper(vcEntityList);

			logger.debug("Updated native wrapper with credentials and callback URL", {
				registryEntries,
				callbackUrl: OPENID4VCI_REDIRECT_URI,
			});
			window.nativeWrapper.updateAllCredentials(
				JSON.stringify(registryEntries),
				OPENID4VCI_REDIRECT_URI,
			);
		})();
	}, [vcEntityList]);

	return children;
};
