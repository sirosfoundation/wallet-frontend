import { useContext } from 'react';
import type { Core } from '@wwwallet/client-core';
import ClientCoreContext from '@/context/ClientCoreContext';

export default function useClientCore(): Core {
	const core = useContext(ClientCoreContext);

	if (!core) {
		throw new Error(
			'useClientCore must be used within a <ClientCoreContextProvider>'
		);
	}

	return core;
}
