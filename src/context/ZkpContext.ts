import { ZkpPresenterClient } from '@sirosfoundation/zkp-req';
import { createContext } from 'react';

export type ZkpContextType = {
	presenterClient: ZkpPresenterClient | null;
};

export const ZkpContext = createContext<ZkpContextType | null>(null);
