import type { Logger } from '@sirosfoundation/browser-log';
import type { GenericStore } from 'wallet-common';
import { StatusList, TokenStatus, TokenStatusListsError } from './resources';

/**
 * Token identifier.
 */
export type TokenId = number;

/**
 * Reference to a token that has a reference in a list.
 */
export type TokenEntity = {
	/**
	 * URI of the token status list.
	 */
	uri: string;
	/**
	 * Index in the list.
	 */
	idx: number;
	/**
	 * Token issuance time.
	 */
	iat?: number;
};

/**
 * A cached token status list.
 */
export type CachedTokenStatusList = {
	uri: string;
	bits: number;
	statuses: Uint8Array;
	iat?: number;
	expiresAt: number;
	etag: string;
};

export type TokenStatusListsListener = (
	changes: Map<TokenId, TokenStatus | undefined>,
) => void;

/**
 * Storage for cached lists.
 */
export interface ITokenStatusListStorage extends GenericStore<
	string,
	CachedTokenStatusList
> {}

export type TokenStatusListsConfig = {
	/**
	 * Logger for status list operations.
	 */
	logger: Logger;
	/**
	 * Storage for cached lists.
	 */
	storage: ITokenStatusListStorage;
	/**
	 * Refresh the list when it expires.
	 */
	refreshListOnExpiry: boolean;
	/**
	 * Error handler.
	 */
	onError?: (err: TokenStatusListsError) => void;
};

/**
 * Manages token status lists and their updates. Either locally in the
 * frontend or through the backend's /status/v1/lists API.
 */
export interface ITokenStatusLists {
	/**
	 * Any first-time setup, loading saved status list from storage, etc.
	 */
	init(): Promise<void>;
	/**
	 * Add new tokens to the map.
	 */
	addTokens(tokens: Map<TokenId, TokenEntity>): void;
	/**
	 * Remove tokens from the map and clears unused lists.
	 */
	removeTokens(ids: TokenId[]): void;
	/**
	 * Replace all tokens with the given ones. Checks and removes unused lists.
	 */
	setTokens(tokens: Map<TokenId, TokenEntity>): void;
	/**
	 * Subscribe to status changes.
	 *
	 * If a token is removed, its status will be undefined, so
	 * consumers can clear their state accordingly.
	 */
	subscribe(listener: TokenStatusListsListener): () => void;
	/**
	 * Current status of every watched token.
	 */
	getStatuses(): ReadonlyMap<TokenId, TokenStatus>;
	/**
	 * Clean up resources and stop any background tasks.
	 */
	dispose(): void;
}

/**
 * A source for status lists. Could be the backend API or local fetching.
 * The source is not responsible for caching, only fetching & parsing.
 */
export interface ITokenStatusListsSource {
	/**
	 * Initialize the source.
	 */
	init?(): Promise<void>;
	/**
	 * Fetch status lists by URIs.
	 */
	fetchLists(toFetch: { uri: string, etag?: string }[]): Promise<StatusList[]>;
	/**
	 * Clean up the source.
	 */
	dispose?(): void;
}
