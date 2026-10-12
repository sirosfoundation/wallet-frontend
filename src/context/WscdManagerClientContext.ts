import { createContext } from 'react';
import type { IWscdManagerClient } from '@/lib/wscd-manager/types';

export type WscdManagerClientContextValue = {
	wscdManagerClient: IWscdManagerClient | null;
};

export const WscdManagerClientContext = createContext<WscdManagerClientContextValue | null>(null);
