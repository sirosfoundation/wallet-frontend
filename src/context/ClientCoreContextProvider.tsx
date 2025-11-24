import React, { useMemo } from 'react';
import ClientCoreContext from './ClientCoreContext';
import { Core } from '@wwwallet/client-core';
import { CORE_CONFIGURATION } from '@/config';
import { useCoreHttpProxy } from '@/lib/services/CoreWrappers/CoreHttpProxy';
import { useCoreClientStateStore } from '@/lib/services/CoreWrappers/ClientStateStore';
import { useCoreVpTokenSigner } from '@/lib/services/CoreWrappers/VpTokenSigner';

type ClientCoreContextProviderProps = {
	children: React.ReactNode;
};

export const ClientCoreContextProvider = ({ children }: ClientCoreContextProviderProps) => {
	const httpClient = useCoreHttpProxy();
	const clientStateStore = useCoreClientStateStore();
	const vpTokenSigner = useCoreVpTokenSigner();

	const core = useMemo(() => {
		return new Core({
			httpClient,
			clientStateStore,
			vpTokenSigner,
			...CORE_CONFIGURATION
		});
	}, [httpClient, clientStateStore, vpTokenSigner]);

	return (
		<ClientCoreContext.Provider value={core}>
		{children}
		</ClientCoreContext.Provider>
	);
};
