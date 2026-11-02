import { FC, PropsWithChildren, useContext, useMemo, useEffect } from 'react';
import { TokenStatusListsContext } from './TokenStatusListsContext';
import {
	TokenStatusLists,
	TokenStatusListsBackendSource,
} from '@sirosfoundation/token-status-list';
import { useHttpClient } from '@/hooks/useHttpClient';
import { BACKEND_URL } from '@/config';
import SessionContext from './SessionContext';
import { logger } from '@/logger';
import { clearTokenStatusLists, tokenStatusListStorage } from '@/indexedDB';

export const TokenStatusListsContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const httpClient = useHttpClient();
	const { authTokens, isLoggedIn } = useContext(SessionContext);

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
					onError: (err) => logger.warn('Token status list check failed', err),
				},
				source,
			),
		[source],
	);

	useEffect(() => () => value.dispose(), [value]);

	// Cached list URIs reveal which issuers the user holds credentials from.
	useEffect(() => {
		if (isLoggedIn) return;
		value.setTokens(new Map());

		void (async () => {
			try {
				await clearTokenStatusLists();
			} catch (err) {
				logger.error('Failed to clear token status lists', err);
			}
		})();
	}, [isLoggedIn, value]);

	return (
		<TokenStatusListsContext.Provider value={value}>
			{children}
		</TokenStatusListsContext.Provider>
	);
};
