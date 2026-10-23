import type { AxiosResponse } from 'axios';
import { Err, Ok, Result } from 'ts-results';

import { logger } from '../logger';
import { Mutex } from '@/lib/utils/mutex';
import type { EncryptedContainer } from '../services/keystore';
import type { CachedUser, CommitCallback, LocalStorageKeystore } from '../services/LocalStorageKeystore';

export const PRIVATE_DATA_CONFLICT = 'x-private-data-etag';

/** Max GET → merge → POST rounds before giving up on a sync. */
export const MAX_PRIVATE_DATA_ATTEMPTS = 3;

export type PrivateDataSyncResult = Result<void, 'syncFailed' | typeof PRIVATE_DATA_CONFLICT>;

export type PrivateDataEdit<T> = () => Promise<[T, EncryptedContainer, CommitCallback]>;

export type PrivateDataMerger = Pick<LocalStorageKeystore, 'syncWithRemoteData'>;

/**
 * I/O primitives used by the coordinator. Implemented by `useApi`.
 */
export type PrivateDataTransport = {
	isOnline: boolean;
	/** `GET /user/session/private-data` with `If-None-Match: <local etag>`. */
	fetchRemote(): Promise<AxiosResponse>;
	/**
	 * Persist a new container (POST when online, IndexedDB when offline).
	 * Must update the local etag on success and reject on a version conflict.
	 * @param ifMatch overrides the local etag for the `X-Private-Data-If-Match` header.
	 */
	save(container: EncryptedContainer, ifMatch?: string): Promise<void>;
	/** Called when the remote copy cannot be merged; triggers re-authentication. */
	onSyncFail(cachedUser: CachedUser | undefined): void;
};

export function isPrivateDataConflict(e: unknown): boolean {
	const err = e as { cause?: unknown; response?: { status?: number } } | null | undefined;
	return err?.cause === PRIVATE_DATA_CONFLICT || err?.response?.status === 412;
}

function conflictError(): Error {
	return new Error('Private data version conflict', { cause: PRIVATE_DATA_CONFLICT });
}

/**
 * Serializes every read-modify-write of the encrypted private data within a tab.
 *
 * Each write rotates the main key, so a sync that overlaps a write ends up
 * holding server data encrypted with a key the tab does not have yet. Running
 * syncs, writes and their local commits under one lock removes that race.
 *
 * The lock is not re-entrant: never call `sync`/`edit`/`write` from inside an
 * `edit` callback or a commit callback.
 */
export class PrivateDataCoordinator {
	#lock = new Mutex();
	#syncInFlight: Promise<PrivateDataSyncResult> | null = null;

	constructor(private readonly maxAttempts: number = MAX_PRIVATE_DATA_ATTEMPTS) { }

	/**
	 * Pull remote private data and merge it into the keystore.
	 * Concurrent calls share the same in-flight sync.
	 */
	sync(
		transport: PrivateDataTransport,
		cachedUser: CachedUser | undefined,
		keystore?: PrivateDataMerger,
	): Promise<PrivateDataSyncResult> {
		if (this.#syncInFlight) {
			return this.#syncInFlight;
		}
		const promise = this.#lock
			.runExclusive(() => this.#syncUnlocked(transport, cachedUser, keystore))
			.finally(() => {
				if (this.#syncInFlight === promise) {
					this.#syncInFlight = null;
				}
			});
		this.#syncInFlight = promise;
		return promise;
	}

	/**
	 * Run `edit` → save → commit atomically with respect to other private-data
	 * operations. On a version conflict the remote copy is merged (when a
	 * keystore is given) and `edit` is re-run against the merged state.
	 * Local state is only committed after the server accepted the write.
	 */
	edit<T>(
		transport: PrivateDataTransport,
		edit: PrivateDataEdit<T>,
		options: { keystore?: PrivateDataMerger, cachedUser?: CachedUser } = {},
	): Promise<T> {
		return this.#lock.runExclusive(async () => {
			for (let attempt = 1; ; attempt++) {
				const [result, container, commit] = await edit();
				try {
					await transport.save(container);
				} catch (e) {
					if (!isPrivateDataConflict(e)) {
						throw e;
					}
					if (options.keystore && attempt < this.maxAttempts) {
						logger.debug(`Private data conflict on write (attempt ${attempt}), merging remote and retrying`);
						const synced = await this.#syncUnlocked(transport, options.cachedUser, options.keystore);
						if (synced.ok) {
							continue;
						}
					}
					throw conflictError();
				}
				await commit();
				return result;
			}
		});
	}

	/**
	 * Save an already-computed container under the lock. The caller must only
	 * commit local state when this resolves. A conflict rejects with
	 * `cause: 'x-private-data-etag'`; prefer `edit()` which can recover.
	 */
	write(transport: PrivateDataTransport, container: EncryptedContainer): Promise<void> {
		return this.#lock.runExclusive(async () => {
			try {
				await transport.save(container);
			} catch (e) {
				if (isPrivateDataConflict(e)) {
					throw conflictError();
				}
				throw e;
			}
		});
	}

	async #syncUnlocked(
		transport: PrivateDataTransport,
		cachedUser: CachedUser | undefined,
		keystore: PrivateDataMerger | undefined,
	): Promise<PrivateDataSyncResult> {
		if (!transport.isOnline) {
			return Ok.EMPTY;
		}

		const requireReauth = (): PrivateDataSyncResult => {
			transport.onSyncFail(cachedUser);
			return Err('syncFailed');
		};

		try {
			for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
				const resp = await transport.fetchRemote();
				if (resp.status === 304) {
					return Ok.EMPTY; // already synced
				}

				if (!keystore) {
					logger.debug('syncPrivateData: remote changed and no keystore to merge with');
					return requireReauth();
				}

				const merge = await keystore.syncWithRemoteData(resp.data.privateData);
				if (!merge.ok) {
					// Remote copy is not decryptable with the local key (written by
					// another tab/device) — only re-authentication can recover.
					logger.debug('syncPrivateData: merge failed', merge.val);
					return requireReauth();
				}

				const [merged, commit] = merge.val;
				const remoteEtag: string | undefined =
					resp.headers?.['x-private-data-etag'] ?? resp.headers?.['etag'];
				try {
					await transport.save(merged, remoteEtag);
				} catch (e) {
					if (isPrivateDataConflict(e)) {
						logger.debug(`syncPrivateData: conflict on merge POST (attempt ${attempt}), retrying`);
						continue;
					}
					throw e;
				}
				await commit();
				logger.debug('syncPrivateData: merged remote and local data');
				return Ok.EMPTY;
			}
		} catch (err) {
			if (isPrivateDataConflict(err)) {
				logger.debug('syncPrivateData: private data etag conflict', err);
				return Err(PRIVATE_DATA_CONFLICT);
			}
			logger.error('syncPrivateData failed', err);
			return Err('syncFailed');
		}

		// Retries exhausted. Nothing was committed locally and the remote copy is
		// decryptable, so re-authentication would not help.
		logger.warn('syncPrivateData: giving up after repeated version conflicts');
		return Err(PRIVATE_DATA_CONFLICT);
	}
}

/** One coordinator per tab. */
export const privateDataCoordinator = new PrivateDataCoordinator();
