import type React from 'react';
import { useContext, useEffect } from 'react';
import { OPENID4VCI_REDIRECT_URI } from '@/config';
import CredentialsContext from '@/context/CredentialsContext';
import { prepareCredentialsForNativeWrapper } from '@/lib/native-wrapper';
import type { NativeWrapper } from '@/lib/native-wrapper/types';
import { logger } from '@/logger';
import keystoreEvents from '../services/keystoreEvents';
import { useLocalStorageKeystore } from '../services/LocalStorageKeystore';

declare global {
	interface Window {
		nativeWrapper?: NativeWrapper;
	}
}

export const NativeWrapperProvider = ({ children }: React.PropsWithChildren) => {
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

			const registryEntries = await prepareCredentialsForNativeWrapper(vcEntityList);

			logger.debug('Updated native wrapper with credentials and callback URL', {
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
