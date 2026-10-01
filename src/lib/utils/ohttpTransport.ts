import { encryptedHttpRequest, HpkeConfig } from '@/lib/utils/ohttpHelpers';
import { HttpTransport, HttpClientError } from '@sirosfoundation/http-client';

/**
 * Creates an HTTP transport that uses OHTTP for encrypted requests.
 */
export function createOhttpTransport(
	ohttpRelay: string,
	keyConfig: HpkeConfig,
): HttpTransport {
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
		} catch (err: any) {
			throw new HttpClientError(
				method,
				500,
				{},
				err.message || `${method} request failed`,
			);
		}
	};
}
