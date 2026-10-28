import { useContext } from 'react';
import { WscdManagerClientContext } from '@/context/WscdManagerClientContext';
import { IWscdManagerClient } from '@/lib/wscd-manager';

export function useWscdManagerClient(): IWscdManagerClient | null {
	const context = useContext(WscdManagerClientContext);
	if (!context) {
		throw new Error(
			'useWscdManagerClient must be used within a WscdManagerClientContextProvider',
		);
	}
	return context.wscdManagerClient;
}
