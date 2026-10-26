import { createContext, useContext } from 'react';

/**
 * - `pending`: a sync for the current URL has not finished yet.
 * - `synced`: local private data is up to date with the server.
 * - `error`: the sync failed in a way re-authentication cannot fix (network
 *   error, repeated version conflicts). Writes remain safe because they merge
 *   and retry on conflict, so flows may proceed.
 * - `reauthRequired`: the remote copy cannot be decrypted locally and the user
 *   is being asked to re-authenticate (`?sync=fail`).
 */
export type PrivateDataSyncStatus = 'pending' | 'synced' | 'error' | 'reauthRequired';

export type PrivateDataSyncContextValue = {
	/** Status of the private-data sync started by `UriHandlerProvider` for the current URL. */
	status: PrivateDataSyncStatus;
};

// Defaults to `synced` so consumers rendered outside the provider are not blocked.
const PrivateDataSyncContext = createContext<PrivateDataSyncContextValue>({ status: 'synced' });

export const usePrivateDataSync = (): PrivateDataSyncContextValue => useContext(PrivateDataSyncContext);

export default PrivateDataSyncContext;
