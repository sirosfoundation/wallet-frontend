import { useContext } from 'react';
import { WscdManagerClientContext } from '@/context/WscdManagerClientContext';

export function useWscdManagerClient() {
	const context = useContext(WscdManagerClientContext);
	if (!context) {
		throw new Error(
			'useWscdManagerClient must be used within a WscdManagerClientContextProvider'
		);
	}

	return context.wscdManagerClient;
}
