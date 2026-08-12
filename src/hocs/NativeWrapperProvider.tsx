import React, { useContext, useEffect } from "react";
import { useLocalStorageKeystore } from "../services/LocalStorageKeystore";
import keystoreEvents from "../services/keystoreEvents";
import CredentialsContext from "@/context/CredentialsContext";
import { prepareCredentialsForNativeWrapper } from "@/lib/native-wrapper";
import { logger } from "@/logger";

declare global {
	interface Window {
		nativeWrapper?: NativeWrapper;
	}

	interface NativeWrapper {
		updateAllCredentials(credentials: string): void;
		getDCAPIRequestOrigin(requestId: string): Promise<string>;
		sendDCAPIResponse(message: Record<string, unknown>): void;
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

			logger.debug("Updated native wrapper with credentials:", registryEntries);
			window.nativeWrapper.updateAllCredentials(JSON.stringify(registryEntries));
		})();
	}, [vcEntityList]);

	return children;
};
