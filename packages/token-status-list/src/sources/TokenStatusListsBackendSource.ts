import {
	StatusList,
	statusListResponseSchema,
	TokenStatusListsError,
} from '../resources';
import { ITokenStatusListsSource } from '../types';
import type { HttpClient } from '@sirosfoundation/http-client';

export type TokenStatusListsBackendSourceProps = {
	httpClient: HttpClient;
	getAuthToken: () => Promise<string>;
	backendUrl: string;
}

/**
 * Fetches status lists via the go-wallet-backend /status/v1/lists API.
 */
export class TokenStatusListsBackendSource implements ITokenStatusListsSource {
	#httpClient: HttpClient;
	#getAuthToken: () => Promise<string>;
	#backendUrl: string;

	readonly #apiEndpoint = '/status/v1/lists';

	constructor({
		httpClient,
		getAuthToken,
		backendUrl,
	}: TokenStatusListsBackendSourceProps) {
		this.#httpClient = httpClient;
		this.#getAuthToken = getAuthToken;
		this.#backendUrl = backendUrl;
	}

	public async fetchLists(
		toFetch: { uri: string, etag?: string }[],
	): Promise<StatusList[]> {
		const res = await this.#httpClient.post(
			new URL(this.#apiEndpoint, this.#backendUrl).toString(),
			{
				lists: toFetch.map(({ uri, etag }) => ({ uri, etag })),
			},
			{
				Authorization: `Bearer ${await this.#getAuthToken()}`,
			},
		);

		if (res.status !== 200) {
			if ([401, 403].includes(res.status))
				throw new TokenStatusListsError('auth');
			throw new TokenStatusListsError('network');
		}

		const { success, data } = statusListResponseSchema.safeParse(res.data);

		if (!success) throw new TokenStatusListsError('malformed');

		return data.results;
	}
}
