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

/** Computes a new container from the keystore state at call time. */
export type PrivateDataEdit<T> = () => Promise<[T, EncryptedContainer, CommitCallback]>;

export type PrivateDataMerger = Pick<LocalStorageKeystore, 'syncWithRemoteData'>;

export type PrivateDataEditOptions = {
	/** When given, a version conflict merges the remote copy and re-runs the edit. */
	keystore?: PrivateDataMerger,
	cachedUser?: CachedUser,
	/**
	 * Upload the edited container through another endpoint (e.g. passkey
	 * register/delete, which carry the private data in their body). Defaults to
	 * `transport.save`. Must update the local etag on success and reject on a
	 * version conflict.
	 */
	save?: (container: EncryptedContainer) => Promise<void>,
};

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
 * Every writer must go through `edit()`, so that reading the current keystore
 * state, uploading and committing happen under the lock as one step.
 *
 * The lock is not re-entrant: never call `sync`/`edit` from inside an `edit`
 * callback, a `save` callback or a commit callback.
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
	 *
	 * `edit` runs under the lock and must read the keystore state it modifies
	 * when it is called (not from a closure), so a retry sees the merged state.
	 * Interactive steps (WebAuthn prompts) should run before calling `edit()`.
	 */
	edit<T>(
		transport: PrivateDataTransport,
		edit: PrivateDataEdit<T>,
		options: PrivateDataEditOptions = {},
	): Promise<T> {
		const save = options.save ?? ((container: EncryptedContainer) => transport.save(container));
		return this.#lock.runExclusive(async () => {
			for (let attempt = 1; ; attempt++) {
				const [result, container, commit] = await edit();
				try {
					await save(container);
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
	 * Run `fn` under the private-data lock. For flows that read, rewrite and
	 * upload private data in ways that do not fit `edit()` (e.g. login, where the
	 * keystore is not open yet). Prefer `edit()` for everything else.
	 */
	exclusive<T>(fn: () => Promise<T>): Promise<T> {
		return this.#lock.runExclusive(fn);
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
