import { FC, PropsWithChildren, useContext, useMemo, useEffect } from 'react';
import { TokenStatusListsContext } from './TokenStatusListsContext';
import {
	CachedTokenStatusList,
	ITokenStatusListStorage,
	TokenStatusLists,
	TokenStatusListsBackendSource,
} from '@sirosfoundation/token-status-list';
import { useHttpClient } from '@/hooks/useHttpClient';
import { BACKEND_URL } from '@/config';
import SessionContext from './SessionContext';
import { logger } from '@/logger';
import localforage from 'localforage';

const store = localforage.createInstance({
	name: 'TokenStatusLists',
	storeName: 'lists',
});

export const tokenStatusListStorage: ITokenStatusListStorage = {
	get: async (uri) =>
		(await store.getItem<CachedTokenStatusList>(uri)) ?? undefined,
	set: async (uri, list) => {
		await store.setItem(uri, list);
	},
	delete: (uri) => store.removeItem(uri),
	async getAll() {
		const lists: CachedTokenStatusList[] = [];
		await store.iterate<CachedTokenStatusList, void>((list) => {
			lists.push(list);
		});
		return lists;
	},
};

export const TokenStatusListsContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const httpClient = useHttpClient();
	const { authTokens } = useContext(SessionContext);

	const source = useMemo(() => new TokenStatusListsBackendSource({
		httpClient,
		backendUrl: BACKEND_URL,
		getAuthToken: async () => (await authTokens.ensureBackendToken()).raw,
	 }), [httpClient, authTokens]);

	const value = useMemo(
		() =>
			new TokenStatusLists(
				{
					logger: logger,
					refreshListOnExpiry: true,
					storage: tokenStatusListStorage,
				},
				source,
			),
		[source],
	);

	useEffect(() => () => value.dispose(), [value]);

	return (
		<TokenStatusListsContext.Provider value={value}>
			{children}
		</TokenStatusListsContext.Provider>
	);
};
