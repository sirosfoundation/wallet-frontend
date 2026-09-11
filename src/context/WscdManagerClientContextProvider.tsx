import { FC, PropsWithChildren, useRef, useMemo } from 'react';
import { WscdManagerClientContext } from './WscdManagerClientContext';
import { WscdManagerClient } from '@/lib/wscd-manager';

export const WscdManagerClientContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const clientRef = useRef<WscdManagerClient>(null);
	clientRef.current ??= new WscdManagerClient();

	const value = useMemo(
		() => ({ wscdManagerClient: clientRef.current! }),
		[],
	);

	return (
		<WscdManagerClientContext.Provider value={value}>
			{children}
		</WscdManagerClientContext.Provider>
	)
};
