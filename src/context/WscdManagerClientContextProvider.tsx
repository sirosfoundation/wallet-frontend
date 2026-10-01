import {
	FC,
	PropsWithChildren,
	useEffect,
	useContext,
	useState,
	useMemo,
} from 'react';
import { WscdManagerClientContext } from './WscdManagerClientContext';
import { WscdManagerClient } from '@/lib/wscd-manager';
import SessionContext from './SessionContext';

export const WscdManagerClientContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const { api, keystore } = useContext(SessionContext);
	const [client, setClient] = useState<WscdManagerClient | null>(null);

	useEffect(() => {
		const c = new WscdManagerClient();
		setClient(c);

		return () => {
			setClient(null);
			void c.dispose();
		};
	}, []);

	useEffect(() => {
		if (!client) return;
		client.setContainerImporter(() => keystore.exportToWscdContainer());
		client.setContainerExporter(async (container) => {
			const [, newPrivateData, commit] =
				await keystore.importFromWscdContainer(container);
			await api.updatePrivateData(newPrivateData);
			await commit();
		});
	}, [client, keystore, api]);

	const value = useMemo(() => ({ wscdManagerClient: client }), [client]);

	return (
		<WscdManagerClientContext.Provider value={value}>
			{children}
		</WscdManagerClientContext.Provider>
	);
};
