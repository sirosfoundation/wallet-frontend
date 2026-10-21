import {
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
	type FC,
	type PropsWithChildren,
} from 'react';
import {
	ZkpPresenterClient,
	type StoredCredential,
	type WalletContext,
} from '@sirosfoundation/zkp-req';
import { ZkpContext } from './ZkpContext';
import CredentialsContext from './CredentialsContext';
import { useWscdManagerClient } from '@/hooks/useWscdManagerClient';

export const ZkpContextProvider: FC<PropsWithChildren> = ({ children }) => {
	const { vcEntityList } = useContext(CredentialsContext);
	const wscd = useWscdManagerClient();
	const [presenterClient, setPresenterClient] = useState<ZkpPresenterClient | null>(null);

	// Effect events read the latest state, so the client is not rebuilt when it changes.
	const findCredentials = useEffectEvent((format: string): StoredCredential[] =>
		(vcEntityList ?? [])
			.filter((credential) => credential.format === format)
			.map((credential) => ({
				id: String(credential.credentialId),
				format: credential.format,
				data: credential.data,
				kid: credential.kid,
			})),
	);

	const signWithKey = useEffectEvent(
		async (kid: string, alg: string, data: Uint8Array): Promise<Uint8Array> => {
			if (!wscd || alg !== 'ES256') {
				throw 'unavailable';
			}
			return wscd.signWithKey(kid, data);
		},
	);

	useEffect(() => {
		/**
		 * @todo Lock `sign` and `metadata` until the user consents.
		 */
		const wallet: WalletContext = {
			// `meta` is not checked: a superset is allowed, the presenter checks each one.
			credentials: async (format) => findCredentials(format),
			metadata: async () => {
				throw new Error('Credential metadata is not available yet');
			},
			anchors: async () => {
				throw new Error('Trust anchors are not available yet');
			},
			sign: (kid, alg, data) => signWithKey(kid, alg, data),
			random: (length) => crypto.getRandomValues(new Uint8Array(length)),
			now: () => new Date(),
		};

		const client = new ZkpPresenterClient({ wallet });
		setPresenterClient(client);

		return () => {
			setPresenterClient(null);
			void client.dispose();
		};
	}, []);

	const value = useMemo(() => ({ presenterClient }), [presenterClient]);

	return (
		<ZkpContext.Provider value={value}>
			{children}
		</ZkpContext.Provider>
	);
};
