import { IWscdManagerClient } from '@/lib/wscd-manager/types';
import { createContext } from 'react';

export type WscdManagerClientContextValue = {
	wscdManagerClient: IWscdManagerClient;
};

export const WscdManagerClientContext = createContext<WscdManagerClientContextValue>(null);
