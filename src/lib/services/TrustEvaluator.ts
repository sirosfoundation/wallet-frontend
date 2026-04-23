/**
 * Trust Evaluator adapters using AuthZEN client from wallet-common.
 *
 * This module bridges the wallet-common AuthZEN client with the
 * wallet trust evaluation interfaces, enabling trust evaluation for:
 * - Verifiers (OpenID4VP): did:web, https, x509_san_dns schemes
 * - Issuers (OpenID4VCI): credential issuer trust evaluation
 *
 * All trust decisions are delegated to the wallet backend's AuthZEN proxy,
 * which routes requests to the configured AuthZEN PDP (go-trust service).
 */

import {
	AuthZENClient,
	AuthZENClientConfig,
	TrustStatus,
	TrustInfo,
	KeyMaterial,
	DIDResolutionResult,
	DIDDocument,
	DIDResolver,
	ClientIdScheme,
	OpenID4VPKeyMaterial,
	TrustEvaluationResult,
	OpenID4VPTrustEvaluator,
} from 'wallet-common';
import type { HttpClient } from 'wallet-common';
import { logger } from '@/logger';

// Re-export types from wallet-common for convenience
export { TrustStatus, TrustInfo, KeyMaterial, DIDResolutionResult, DIDDocument, DIDResolver, ClientIdScheme, OpenID4VPKeyMaterial, TrustEvaluationResult, OpenID4VPTrustEvaluator };

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
 * const result = await evaluateTrust({
 *   clientIdScheme: { scheme: 'did', clientId: 'did:web:verifier.example.com' },
 *   keyMaterial: { type: 'jwk', key: verifierJwk },
 * });
 *
 * if (result.trusted) {
 *   console.log(`Trusted verifier: ${result.name}`);
 * }
 * ```
 */
export function createVerifierTrustEvaluator(config: TrustEvaluatorConfig): OpenID4VPTrustEvaluator {
	const clientConfig: AuthZENClientConfig = {
		httpClient: config.httpClient,
		baseUrl: config.backendUrl,
		getAuthToken: config.getAuthToken,
		tenantId: config.tenantId,
		timeout: config.timeout,
	};

	const authzenClient = AuthZENClient(clientConfig);

	return async (params): Promise<TrustEvaluationResult> => {
		const { clientIdScheme, keyMaterial, requestUri, responseUri } = params;

		// Build context with request/response URIs for additional validation
		const context: Record<string, unknown> = {};
		if (requestUri) {
			context.request_uri = requestUri;
		}
		if (responseUri) {
			context.response_uri = responseUri;
		}

		// Map key material to AuthZEN format
		const authzenKeyMaterial: KeyMaterial = {
			type: keyMaterial.type,
			key: keyMaterial.key,
		};

		// Call the AuthZEN evaluator
		const result = await authzenClient.evaluateVerifier({
			clientId: clientIdScheme.clientId,
			keyMaterial: authzenKeyMaterial,
			context,
		});

		if (result.ok === false) {
			logger.error('Trust evaluation failed:', result.error);
			// Return untrusted on error
			return {
				trusted: false,
				status: TrustStatus.UNKNOWN,
				metadata: { error: String(result.error) },
			};
		}

		const trustInfo = result.value;

		return {
			trusted: trustInfo.status === TrustStatus.TRUSTED,
			status: trustInfo.status,
			name: trustInfo.name,
			logo: trustInfo.logo,
			metadata: (trustInfo.metadata ?? {}) as Record<string, unknown>,
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
	 * Trust status from AuthZEN evaluation.
	 */
	status: TrustStatus;

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
		const authzenKeyMaterial: KeyMaterial = keyMaterial
			? {
					type: keyMaterial.type,
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

		if (result.ok === false) {
			logger.error('Issuer trust evaluation failed:', result.error);
			return {
				trusted: false,
				status: TrustStatus.UNKNOWN,
				metadata: { error: String(result.error) },
			};
		}

		const trustInfo = result.value;

		return {
			trusted: trustInfo.status === TrustStatus.TRUSTED,
			status: trustInfo.status,
			name: trustInfo.name,
			logo: trustInfo.logo,
			metadata: (trustInfo.metadata ?? {}) as Record<string, unknown>,
		};
	};
}

/**
 * Create a DID resolver that uses the AuthZEN backend for resolution.
 *
 * This resolver calls the wallet backend's /v1/resolve endpoint,
 * which resolves DIDs and returns the DID document with public keys.
 *
 * @example
 * ```typescript
 * const resolveDid = createDIDResolver({
 *   httpClient: defaultHttpClient,
 *   backendUrl: BACKEND_URL,
 *   getAuthToken: () => sessionStorage.getItem('appToken'),
 *   tenantId: 'default',
 * });
 *
 * const result = await resolveDid('did:web:verifier.example.com');
 *
 * if (result.resolved && result.didDocument) {
 *   console.log('DID Document:', result.didDocument);
 * }
 * ```
 */
export function createDIDResolver(config: TrustEvaluatorConfig): DIDResolver {
	const clientConfig: AuthZENClientConfig = {
		httpClient: config.httpClient,
		baseUrl: config.backendUrl,
		getAuthToken: config.getAuthToken,
		tenantId: config.tenantId,
		timeout: config.timeout,
	};

	const authzenClient = AuthZENClient(clientConfig);

	return async (did: string): Promise<DIDResolutionResult> => {
		logger.debug('Resolving DID via AuthZEN backend:', did);

		const result = await authzenClient.resolve(did);

		if (result.ok === false) {
			logger.error('DID resolution failed:', result.error);
			return {
				resolved: false,
				error: String(result.error),
			};
		}

		const response = result.value;

		// Extract DID document from trust_metadata
		const didDocument = response.context?.trust_metadata as DIDDocument | undefined;

		if (!didDocument || !didDocument.id) {
			logger.warn('DID resolved but no document returned for:', did);
			return {
				resolved: false,
				error: 'No DID document in resolution response',
			};
		}

		return {
			resolved: true,
			didDocument,
			metadata: response.context?.trust_metadata
				? { ...response.context.trust_metadata }
				: undefined,
		};
	};
}
