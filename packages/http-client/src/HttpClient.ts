import { Logger } from '@sirosfoundation/browser-log';
import {
	CachedEntry,
	HttpClientRequestOptions,
	HttpResponse,
	HttpTransport,
	IndexedDB,
} from './types';
import { HttpClientError } from './resources';
import { axiosHttpTransport } from './transports/axios';

export type HttpClientOptions = {
	isOnline: boolean;
	logger: Logger;
	transport?: HttpTransport;
	decorateHeaders?: (req: {
		url: string;
		method: 'GET' | 'POST';
	}) => Record<string, string>;
	indexedDB?: IndexedDB;
};

/**
 * Http Client with built-in support for:
 * - Caching with Cache-Control respect and offline fallback
 * - Request deduplication
 * - A pluggable transport (default axios; e.g. OHTTP can be injected)
 */
export class HttpClient {
	#isOnline: boolean | null;
	#logger: Logger;
	#transport: HttpTransport;
	#decorateHeaders?: (req: {
		url: string;
		method: 'GET' | 'POST';
	}) => Record<string, string>;
	#indexedDB?: IndexedDB;
	#inFlightRequests = new Map<string, Promise<HttpResponse>>();

	constructor({
		isOnline,
		logger,
		transport,
		decorateHeaders,
		indexedDB,
	}: HttpClientOptions) {
		this.#isOnline = isOnline;
		this.#logger = logger;
		this.#transport = transport ?? axiosHttpTransport;
		this.#decorateHeaders = decorateHeaders;
		this.#indexedDB = indexedDB;
	}

	public setIsOnline(isOnline: boolean) {
		this.#isOnline = isOnline;
	}

	public setTransport(transport: HttpTransport) {
		this.#transport = transport;
	}

	public async get(
		url: string,
		headers?: Record<string, string>,
		options?: HttpClientRequestOptions,
	): Promise<HttpResponse> {
		return this.#request('GET', url, undefined, headers, options);
	}

	public async post(
		url: string,
		body: string | object,
		headers?: Record<string, string>,
		options?: HttpClientRequestOptions,
	): Promise<HttpResponse> {
		return this.#request('POST', url, body, headers, options);
	}

	async #request(
		method: 'GET' | 'POST',
		url: string,
		body?: string | object,
		headers?: Record<string, string>,
		options?: HttpClientRequestOptions,
	): Promise<HttpResponse> {
		const { useCache = false, wantRaw = false, binary } = options || {};
		const isBinary = binary ?? isBinaryUrl(url);
		const now = Math.floor(Date.now() / 1000);

		const cacheKey = [
			'v2',
			isBinary ? 'blob' : 'data',
			url,
			body ? await this.#hashBody(body) : undefined,
		].join('::');

		if (this.#isOnline === false) {
			const fallback = await this.#readCache(cacheKey, now, wantRaw, true);
			if (fallback) return fallback;
			return {
				status: 504,
				headers: {},
				data: 'No cached response available and offline',
			};
		}

		if (useCache) {
			const cached = await this.#readCache(cacheKey, now, wantRaw);
			if (cached) return cached;
		}

		if (this.#inFlightRequests.has(cacheKey)) {
			return this.#inFlightRequests.get(cacheKey)!;
		}

		const requestPromise = this.#executeRequest(
			method,
			url,
			body,
			headers,
			useCache,
			wantRaw,
			isBinary,
			now,
			cacheKey,
		);
		this.#inFlightRequests.set(cacheKey, requestPromise);
		return requestPromise;
	}

	async #executeRequest(
		method: 'GET' | 'POST',
		url: string,
		body: string | object | undefined,
		headers: Record<string, string> | undefined,
		useCache: boolean,
		wantRaw: boolean,
		isBinary: boolean,
		now: number,
		cacheKey: string,
	): Promise<HttpResponse> {
		try {
			const mergedHeaders = {
				...headers,
				...this.#decorateHeaders?.({ url, method }),
			};

			const {
				status,
				headers: responseHeaders,
				body: bytes,
			} = await this.#transport({
				method,
				url,
				body,
				headers: mergedHeaders,
			});

			const contentType = responseHeaders['content-type'] as string | undefined;
			const isSuccess = status >= 200 && status < 300;
			const { shouldCache, maxAge } = this.#parseCacheSettings(
				useCache && isSuccess,
				responseHeaders['cache-control'] as string | undefined,
			);

			if (shouldCache) {
				await this.#addToCache(cacheKey, {
					data: {
						status,
						headers: responseHeaders,
						bytes,
						contentType,
						binary: isBinary,
					},
					expiry: now + maxAge,
				});
			}

			const data = decodeBody(bytes, isBinary);
			return {
				status,
				headers: responseHeaders,
				data,
				...(wantRaw && { raw: bytes }),
			};
		} catch (err) {
			if (err instanceof HttpClientError) {
				const fallback = await this.#readCache(cacheKey, now, wantRaw, true);
				if (fallback) {
					this.#logger.warn('[HttpClient] Request failed, using stale cache');
					return fallback;
				}
				return {
					status: err.status,
					headers: err.headers,
					data: err.responseData,
				};
			}
			throw err;
		} finally {
			this.#inFlightRequests.delete(cacheKey);
		}
	}

	async #readCache(
		cacheKey: string,
		now: number,
		wantRaw: boolean,
		ignoreExpiry = false,
	): Promise<HttpResponse | null> {
		try {
			const cached = await this.#getFromCache(cacheKey);
			if (!cached?.data || !cached?.expiry) return null;

			const isFresh = now < cached.expiry;
			if (!ignoreExpiry && this.#isOnline !== null && !isFresh) return null;

			const { status, headers, bytes, contentType, binary } = cached.data;
			if (!(bytes instanceof Uint8Array)) return null;
			const data = decodeBody(bytes, binary);
			return { status, headers, data, ...(wantRaw && { raw: bytes }) };
		} catch (err) {
			this.#logger.warn('[HttpClient] Failed cache read', err);
			return null;
		}
	}

	#parseCacheSettings(useCache: boolean, cacheControlHeader?: string) {
		let shouldCache = useCache;
		let maxAge = 60 * 30;

		if (shouldCache && typeof cacheControlHeader === 'string') {
			const lower = cacheControlHeader.toLowerCase();
			if (lower.includes('no-store')) shouldCache = false;
			else if (lower.includes('no-cache')) maxAge = 0;
			else {
				const parsed = this.#parseCacheControl(lower);
				if (typeof parsed['max-age'] === 'number') {
					maxAge = parsed['max-age'];
					if (maxAge < 0) shouldCache = false;
				}
			}
		}

		if (!this.#indexedDB) shouldCache = false;

		return { shouldCache, maxAge };
	}

	#parseCacheControl(header: string): Record<string, string | number> {
		return Object.fromEntries(
			header.split(',').map((d) => {
				const [key, value] = d
					.trim()
					.split('=')
					.map((v) => v.trim());
				const num = Number(value);
				return [key, isNaN(num) ? value : num];
			}),
		);
	}

	async #hashBody(body: unknown): Promise<string> {
		const json = JSON.stringify(body);
		const data = new TextEncoder().encode(json);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	async #getFromCache(cacheKey: string): Promise<CachedEntry | null> {
		return (
			this.#indexedDB?.getItem('requestCache', cacheKey, 'requestCache') ?? null
		);
	}

	async #addToCache(cacheKey: string, cached: CachedEntry): Promise<void> {
		await this.#indexedDB?.addItem(
			'requestCache',
			cacheKey,
			cached,
			'requestCache',
		);
	}
}

function decodeBody(bytes: Uint8Array, binary: boolean): unknown {
	if (binary) return bytes;
	const text = new TextDecoder().decode(bytes);
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico)$/i;

function isBinaryUrl(url: string): boolean {
	const path = url.split('?')[0].split('#')[0];
	return BINARY_EXT.test(path);
}
