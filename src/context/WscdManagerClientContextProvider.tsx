import { FC, PropsWithChildren, useRef, useMemo, useEffect, useContext } from 'react';
import { WscdManagerClientContext } from './WscdManagerClientContext';
import { WscdManagerClient } from '@/lib/wscd-manager';
import SessionContext from './SessionContext';

export const WscdManagerClientContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const clientRef = useRef<WscdManagerClient>(null);
	clientRef.current ??= new WscdManagerClient();

	const { keystore } = useContext(SessionContext);

	const value = useMemo(
		() => ({ wscdManagerClient: clientRef.current! }),
		[],
	);

	useEffect(() => {
		clientRef.current?.setContainerImporter(async () => {
			return keystore.exportToWscdContainer();
		})
	}, [keystore])

	return (
		<WscdManagerClientContext.Provider value={value}>
			{children}
		</WscdManagerClientContext.Provider>
	)
};
