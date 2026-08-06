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
		platform: "android" | "ios";
		updateAllCredentials(credentials: string): void;
		isKeystoreOpen(): Promise<boolean>;
		startScanPhysicalId?(): void;
		DCAPI: {
			getRequestOrigin(requestId: string): Promise<string>;
			sendResponse(message: Record<string, unknown>): void;
			close(): void;
		}
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
