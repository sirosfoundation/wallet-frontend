import { type FC, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { WscdManagerClient } from '@/lib/wscd-manager';
import SessionContext from './SessionContext';
import { WscdManagerClientContext } from './WscdManagerClientContext';

export const WscdManagerClientContextProvider: FC<PropsWithChildren> = ({ children }) => {
	const { api, keystore } = useContext(SessionContext);
	const [client, setClient] = useState<WscdManagerClient | null>(null);

	useEffect(() => {
		const c = new WscdManagerClient();
		setClient(c);

		return () => {
			setClient(null);
			// biome-ignore lint/complexity/noVoid: baseline: pre-existing debt. should be fixed
			void c.dispose();
		};
	}, []);

	useEffect(() => {
		if (!client) return;
		client.setContainerImporter(() => keystore.exportToWscdContainer());
		client.setContainerExporter(async (container) => {
			const [, newPrivateData, commit] = await keystore.importFromWscdContainer(container);
			await api.updatePrivateData(newPrivateData);
			await commit();
		});
	}, [client, keystore, api]);

	const value = useMemo(() => ({ wscdManagerClient: client }), [client]);

	return (
		<WscdManagerClientContext.Provider value={value}>{children}</WscdManagerClientContext.Provider>
	);
};
