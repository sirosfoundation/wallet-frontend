import { useContext } from 'react';
import { ZkpContext, type ZkpContextType } from '@/context/ZkpContext';

export function useZkp(): ZkpContextType {
	const context = useContext(ZkpContext);
	if (!context) {
		throw new Error('useZkp must be used within a ZkpContextProvider');
	}
	return context;
}
