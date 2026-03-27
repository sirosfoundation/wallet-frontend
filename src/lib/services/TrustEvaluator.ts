/**
 * Trust Evaluator adapter for OpenID4VP using AuthZEN client.
 *
 * This module bridges the wallet-common AuthZEN client with the
 * OpenID4VP trust evaluation interface, enabling multi-scheme
 * verifier authentication (did:web, https, x509_san_dns, etc.).
 */

import {
	AuthZENClient,
	AuthZENClientConfig,
	TrustStatus,
	OpenID4VPTrustEvaluator,
	TrustEvaluationResult,
	ClientIdScheme,
	OpenID4VPKeyMaterial,
} from 'wallet-common';
import { HttpClient } from 'wallet-common';

/**
 * Configuration for creating a trust evaluator.
 */
export interface TrustEvaluatorConfig {
	/**
	 * HTTP client for making requests.
	 */
	httpClient: HttpClient;

	/**
	 * Base URL of the wallet backend (e.g., "https://wallet-backend.example.com").
	 */
	backendUrl: string;

	/**
	 * Function to retrieve the current auth token.
	 */
	getAuthToken: () => string | Promise<string>;

	/**
	 * Tenant ID for multi-tenant backend.
	 */
	tenantId: string;

	/**
	 * Request timeout in milliseconds (default: 30000).
	 */
	timeout?: number;
}

/**
 * Create an OpenID4VP trust evaluator using the AuthZEN client.
 *
 * This evaluator calls the wallet backend's /v1/evaluate endpoint,
 * which proxies requests to the configured AuthZEN PDP (go-trust service).
 *
 * @example
 * ```typescript
 * const evaluateTrust = createTrustEvaluator({
 *   httpClient: defaultHttpClient,
 *   backendUrl: BACKEND_URL,
 *   getAuthToken: () => sessionStorage.getItem('appToken'),
 *   tenantId: 'default',
 * });
 *
 * // Use with OpenID4VPServerAPI
 * const server = new OpenID4VPServerAPI({
 *   // ... other deps
 *   evaluateTrust,
 * });
 * ```
 */
export function createTrustEvaluator(config: TrustEvaluatorConfig): OpenID4VPTrustEvaluator {
	const clientConfig: AuthZENClientConfig = {
		httpClient: config.httpClient,
		baseUrl: config.backendUrl,
		getAuthToken: config.getAuthToken,
		tenantId: config.tenantId,
		timeout: config.timeout,
	};

	const authzenClient = AuthZENClient(clientConfig);

	return async (params: {
		clientIdScheme: ClientIdScheme;
		keyMaterial: OpenID4VPKeyMaterial;
		requestUri?: string;
		responseUri?: string;
	}): Promise<TrustEvaluationResult> => {
		const { clientIdScheme, keyMaterial, requestUri, responseUri } = params;

		// Build context with request/response URIs for additional validation
		const context: Record<string, unknown> = {};
		if (requestUri) {
			context.request_uri = requestUri;
		}
		if (responseUri) {
			context.response_uri = responseUri;
		}

		// Map key material type to AuthZEN format
		const authzenKeyMaterial = {
			type: keyMaterial.type as 'jwk' | 'x5c' | 'x509_san_dns',
			key: keyMaterial.key,
		};

		// Call the AuthZEN evaluator
		const result = await authzenClient.evaluateVerifier({
			clientId: clientIdScheme.clientId,
			keyMaterial: authzenKeyMaterial,
			context,
		});

		if (!result.ok) {
			console.error('Trust evaluation failed:', result.error);
			// Return untrusted on error
			return {
				trusted: false,
				metadata: { error: result.error },
			};
		}

		const trustInfo = result.value;

		return {
			trusted: trustInfo.status === TrustStatus.TRUSTED,
			name: trustInfo.name,
			logo: trustInfo.logo,
			metadata: trustInfo.metadata,
		};
	};
}
