import type { Logger } from '@sirosfoundation/browser-log';
import type {
	ITokenStatusLists,
	ITokenStatusListsSource,
	ITokenStatusListStorage,
	TokenId,
	TokenEntity,
	TokenStatusListsConfig,
	TokenStatusListsListener,
} from './types';
import { StatusList, TokenStatus, TokenStatusListsError } from './resources';
import { decompressStatusListToArray, readTokenStatusFromArray, resolveTokenStatus } from './utils';

export class TokenStatusLists implements ITokenStatusLists {
	readonly #logger: Logger;
	readonly #storage: ITokenStatusListStorage;
	readonly #refreshListOnExpiry: boolean;
	readonly #onError?: (err: any) => void;

	// For now, only the backend source is used.
	// Potentially add more sources later.
	#source: ITokenStatusListsSource;

	#tokens = new Map<TokenId, TokenEntity>();
	#statuses = new Map<TokenId, TokenStatus>();
	#subscribers = new Set<TokenStatusListsListener>();

	#schedule?: ReturnType<typeof setInterval>;
	#inFlight: Promise<void> | null = null;
	#rerun = false;

	readonly #INTERVAL = 1000 * 60 * 5;

	// Backend recommends 1-3 lists per request so it can't link issuers together.
	readonly #LISTS_PER_REQUEST = 1;

	#debounce?: ReturnType<typeof setTimeout>;

	constructor(
		{
			logger,
			storage,
			refreshListOnExpiry,
			onError,
		}: TokenStatusListsConfig,
		source: ITokenStatusListsSource,
	) {
		this.#logger = logger;
		this.#storage = storage;
		this.#refreshListOnExpiry = refreshListOnExpiry;
		this.#onError = onError;
		this.#source = source;
	}

	public async init() {
		// no-op for now
	}

	public dispose(): void {
		this.#subscribers.clear();
		clearInterval(this.#schedule);
		clearTimeout(this.#debounce);
	}

	public addTokens(tokens: Map<TokenId, TokenEntity>): void {
		for (const [id, ref] of tokens) this.#tokens.set(id, ref);

		this.#queueRestart();
	}

	public removeTokens(ids: TokenId[]): void {
		for (const id of ids) this.#tokens.delete(id);

		this.#queueRestart();
	}

	public setTokens(tokens: Map<TokenId, TokenEntity>): void {
		this.#tokens.clear();
		for (const [id, ref] of tokens) this.#tokens.set(id, ref);

		this.#queueRestart();
	}

	public subscribe(listener: TokenStatusListsListener): () => void {
		this.#subscribers.add(listener);

		return () => this.#subscribers.delete(listener);
	}

	public getStatuses(): ReadonlyMap<TokenId, TokenStatus> {
		return this.#statuses;
	}

	#queueRestart() {
		clearTimeout(this.#debounce);
		this.#debounce = setTimeout(() => this.#restartSchedule(), 100);
	}

	#restartSchedule() {
		clearInterval(this.#schedule);
		this.#runCheck();
		this.#schedule = setInterval(() => this.#runCheck(), this.#INTERVAL);
	}

	async #runCheck() {
		// Tokens changed mid-check, so run again afterwards instead of skipping.
		if (this.#inFlight) {
			this.#rerun = true;
			return;
		}

		try {
			this.#inFlight = this.#check();
			await this.#inFlight;
		} catch (err) {
			this.#onError?.(err);
		} finally {
			this.#inFlight = null;
			if (this.#rerun) {
				this.#rerun = false;
				this.#runCheck();
			}
		}
	}

	async #check(): Promise<void> {
		await this.#dropUnusedLists();
		const toFetch = await this.#findListsToFetch();
		const res = await this.#fetchLists(toFetch);
		await this.#handleFetchedLists(res);
		const current = await this.#readStatuses();
		this.#handleChangedStatuses(current);
	}

	/**
	 * Drop lists no token uses anymore from storage.
	 */
	async #dropUnusedLists() {
		const lists = await this.#storage.getAll();
		const used = new Set(Array.from(this.#tokens.values(), ({ uri }) => uri));

		await Promise.all(
			lists
				.filter((list) => !used.has(list.uri))
				.map((list) => this.#storage.delete(list.uri)),
		);
	}

	/**
	 * Pick lists that are missing, or past their expiry time when
	 * refreshListOnExpiry is enabled.
	 */
	async #findListsToFetch(): Promise<{ uri: string; etag?: string }[]> {
		const lists = await this.#storage.getAll();
		const cached = new Set(lists.map((l) => l.uri));
		const wanted = new Set(Array.from(this.#tokens.values(), ({ uri }) => uri));

		const missing = [...wanted]
			.filter((uri) => !cached.has(uri))
			.map((uri) => ({ uri }));

		if (!this.#refreshListOnExpiry) return missing;

		const expired = lists
			.filter((l) => l.expiresAt < Date.now())
			.map(({ uri, etag }) => ({ uri, etag }));

		return [...missing, ...expired];
	}

	/**
	 * Fetch lists from the source in small batches, sending stored etags.
	 * A failing batch is reported and skipped so the others still update.
	 * Stops when the source becomes unavailable.
	 */
	async #fetchLists(
		toFetch: { uri: string; etag?: string }[],
	): Promise<StatusList[]> {
		const results: StatusList[] = [];

		for (let i = 0; i < toFetch.length; i += this.#LISTS_PER_REQUEST) {
			if (!this.#source.isAvailable()) break;

			const batch = toFetch.slice(i, i + this.#LISTS_PER_REQUEST);
			try {
				results.push(...(await this.#source.fetchLists(batch)));
			} catch (err) {
				this.#onError?.(err);
			}
		}

		return results;
	}

	/**
	 * Store fetched lists:
	 * - verified: decompress and store
	 * - not_modified: keep the bytes, update expiresAt
	 * - undetermined: keep the old list
	 */
	async #handleFetchedLists(res: StatusList[]) {
		await Promise.all(res.map(async (list) => {
			try {
				switch (list.state) {
					case 'verified': {
						this.#logger.debug('verified', list.uri);
						const decompressed = await decompressStatusListToArray(list.lst);
						await this.#storage.set(list.uri, {
							uri: list.uri,
							bits: list.bits,
							etag: list.etag,
							iat: list.iat,
							expiresAt: list.expiresAt * 1000,
							statuses: decompressed,
						});
						break;
					}
					case 'not_modified': {
						const existing = await this.#storage.get(list.uri);
						if (existing) {
							this.#logger.debug('not modified', list.uri);
							existing.expiresAt = list.expiresAt * 1000;
							await this.#storage.set(existing.uri, existing);
						}
						break;
					}
					case 'undetermined': {
						this.#logger.debug('undetermined', list.uri);
						break;
					}
				}
			} catch (err) {
				this.#onError?.(err);
			}
		}));
	}

	/**
	 * Work out each token's status from its cached list. Tokens whose list is
	 * missing are skipped, so they keep their last known status.
	 */
	async #readStatuses(): Promise<Map<TokenId, TokenStatus>> {
		const lists = await this.#storage.getAll();
		const current = new Map<TokenId, TokenStatus>();

		for (const [id, token] of this.#tokens) {
			const list = lists.find((l) => l.uri === token.uri);
			if (!list) continue;

			// A list signed before the token was issued says nothing about it.
			if (token.iat !== undefined && list.iat < token.iat) {
				current.set(id, TokenStatus.PENDING);
				continue;
			}

			try {
				const status = readTokenStatusFromArray(list.statuses, list.bits, token.idx);
				current.set(id, resolveTokenStatus(status));
			} catch (err) {
				if (!(err instanceof TokenStatusListsError)) throw err;
				this.#onError?.(err);
				current.set(id, TokenStatus.UNKNOWN);
			}
		}

		return current;
	}

	/**
	 * Compare with the previous statuses, save them in memory, and notify
	 * subscribers of what changed. Removed tokens are reported as undefined.
	 */
	#handleChangedStatuses(current: Map<TokenId, TokenStatus>) {
		const changes = new Map<TokenId, TokenStatus | undefined>();
		const next = new Map(this.#statuses);

		for (const [id, status] of current) {
			if (next.get(id) === status) continue;
			next.set(id, status);
			changes.set(id, status);
		}

		for (const id of next.keys()) {
			if (this.#tokens.has(id)) continue;
			next.delete(id);
			changes.set(id, undefined);
		}

		if (!changes.size) return;

		// Replaced, never mutated
		this.#statuses = next;
		this.#notifySubscribers(changes);
	}

	#notifySubscribers(changes: Map<TokenId, TokenStatus | undefined>) {
		for (const sub of this.#subscribers) sub(changes);
	}
}
