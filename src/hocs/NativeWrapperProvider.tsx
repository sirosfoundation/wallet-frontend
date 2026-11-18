import React, { useContext, useEffect } from 'react';
import CredentialsContext from '@/context/CredentialsContext';
import { prepareCredentialsForNativeWrapper } from '@/lib/native-wrapper';
import { logger } from '@/logger';
import { OPENID4VCI_REDIRECT_URI } from '@/config';
import { NativeWrapper } from '@/lib/native-wrapper/types';
import SessionContext from '@/context/SessionContext';

declare global {
	interface Window {
		nativeWrapper?: NativeWrapper;
	}
}

export const NativeWrapperProvider = ({
	children,
}: React.PropsWithChildren) => {
	const { keystore } = useContext(SessionContext);
	const { vcEntityList } = useContext(CredentialsContext);

	useEffect(() => {
		if (window.nativeWrapper) {
			window.nativeWrapper.isKeystoreOpen = async () => keystore.isOpen();
		}
	}, [keystore]);

	useEffect(() => {
		(async () => {
			if (!window.nativeWrapper || !vcEntityList) return;

			const registryEntries =
				await prepareCredentialsForNativeWrapper(vcEntityList);

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
