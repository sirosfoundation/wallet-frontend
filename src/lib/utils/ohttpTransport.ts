import { HttpClientError, type HttpTransport } from '@sirosfoundation/http-client';
import { encryptedHttpRequest, type HpkeConfig } from '@/lib/utils/ohttpHelpers';

/**
 * Creates an HTTP transport that uses OHTTP for encrypted requests.
 */
export function createOhttpTransport(ohttpRelay: string, keyConfig: HpkeConfig): HttpTransport {
	return async ({ method, url, body, headers }) => {
		try {
			const res = await encryptedHttpRequest(ohttpRelay, keyConfig, {
				method,
				url,
				headers,
				...(body && { body }),
			});
			return {
				status: res.status,
				headers: res.headers || {},
				body: new Uint8Array(res.body),
			};
			// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
		} catch (err: any) {
			throw new HttpClientError(method, 500, {}, err.message || `${method} request failed`);
		}
	};
}
