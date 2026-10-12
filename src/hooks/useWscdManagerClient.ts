import { useContext } from 'react';
import { WscdManagerClientContext } from '@/context/WscdManagerClientContext';
import type { IWscdManagerClient } from '@/lib/wscd-manager';

export function useWscdManagerClient(): IWscdManagerClient | null {
	const context = useContext(WscdManagerClientContext);
	if (!context) {
		// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
		throw new Error('useWscdManagerClient must be used within a WscdManagerClientContextProvider');
	}
	return context.wscdManagerClient;
}
