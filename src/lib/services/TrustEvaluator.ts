/**
 * Trust Evaluator adapters using AuthZEN client.
 *
 * This module bridges the wallet-common AuthZEN client with the
 * wallet trust evaluation interfaces, enabling trust evaluation for:
 * - Verifiers (OpenID4VP): did:web, https, x509_san_dns schemes
 * - Issuers (OpenID4VCI): credential issuer trust evaluation
 *
 * All trust decisions are delegated to the AuthZEN backend.
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

/**
 * Issuer trust evaluation parameters.
 */
export interface IssuerTrustEvaluationParams {
	/**
	 * The credential issuer identifier (URL).
	 */
	issuerId: string;

	/**
	 * Key material from the issuer's signed_metadata JWT or certificate.
	 * If not available, pass undefined and trust evaluation will be based on the issuer ID only.
	 */
	keyMaterial?: {
		type: 'jwk' | 'x5c';
		key: unknown | unknown[];
	};

	/**
	 * Additional context (e.g., credential configuration).
	 */
	context?: Record<string, unknown>;
}

/**
 * Issuer trust evaluation result.
 */
export interface IssuerTrustResult {
	/**
	 * Whether the issuer is trusted.
	 */
	trusted: boolean;

	/**
	 * Issuer's display name (from OIDF entity statement or DID document).
	 */
	name?: string;

	/**
	 * Issuer's logo URL.
	 */
	logo?: string;

	/**
	 * Additional metadata from trust evaluation.
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Issuer trust evaluator function type.
 */
export type IssuerTrustEvaluator = (params: IssuerTrustEvaluationParams) => Promise<IssuerTrustResult>;

/**
 * Create an issuer trust evaluator using the AuthZEN client.
 *
 * This evaluator calls the wallet backend's /v1/evaluate endpoint
 * to verify issuer trustworthiness before credential issuance.
 *
 * @example
 * ```typescript
 * const evaluateIssuer = createIssuerTrustEvaluator({
 *   httpClient: defaultHttpClient,
 *   backendUrl: BACKEND_URL,
 *   getAuthToken: () => sessionStorage.getItem('appToken'),
 *   tenantId: 'default',
 * });
 *
 * // Check issuer trust before issuance
 * const result = await evaluateIssuer({
 *   issuerId: 'https://issuer.example.com',
 *   keyMaterial: { type: 'x5c', key: x5cChain },
 * });
 *
 * if (!result.trusted) {
 *   throw new Error('Untrusted issuer');
 * }
 * ```
 */
export function createIssuerTrustEvaluator(config: TrustEvaluatorConfig): IssuerTrustEvaluator {
	const clientConfig: AuthZENClientConfig = {
		httpClient: config.httpClient,
		baseUrl: config.backendUrl,
		getAuthToken: config.getAuthToken,
		tenantId: config.tenantId,
		timeout: config.timeout,
	};

	const authzenClient = AuthZENClient(clientConfig);

	return async (params: IssuerTrustEvaluationParams): Promise<IssuerTrustResult> => {
		const { issuerId, keyMaterial, context } = params;

		// If no key material, use a minimal request with just the issuer ID
		const authzenKeyMaterial = keyMaterial
			? {
				type: keyMaterial.type as 'jwk' | 'x5c',
				key: keyMaterial.key,
			}
			: {
				type: 'jwk' as const,
				key: {}, // Empty JWK - trust based on issuer ID resolution only
			};

		const result = await authzenClient.evaluateIssuer({
			issuerId,
			keyMaterial: authzenKeyMaterial,
			context,
		});

		if (!result.ok) {
			console.error('Issuer trust evaluation failed:', result.error);
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
