/**
 * Trust Evaluator adapters using AuthZEN client.
 *
 * This module bridges the wallet-common AuthZEN client with the
 * wallet trust evaluation interfaces, enabling trust evaluation for:
 * - Verifiers (OpenID4VP): did:web, https, x509_san_dns schemes
 * - Issuers (OpenID4VCI): credential issuer trust evaluation
 *
 * All trust decisions are delegated to the AuthZEN backend.
 *
 * NOTE: This is a stub implementation. Full AuthZEN client integration
 * will be added when wallet-common exports the AuthZEN client types.
 * Currently, trust evaluation falls back to the backend WebSocket transport
 * which handles trust evaluation server-side.
 */

import type { HttpClient } from 'wallet-common';
import { TrustStatus } from '@/lib/transport/types/TrustTypes';
import { logger } from '@/logger';

// Re-export TrustStatus for convenience
export { TrustStatus };

/**
 * Client ID scheme for OpenID4VP
 */
export interface ClientIdScheme {
scheme: 'did' | 'https' | 'x509_san_dns' | 'redirect_uri';
clientId: string;
}

/**
 * Key material for trust evaluation
 */
export interface OpenID4VPKeyMaterial {
type: 'jwk' | 'x5c' | 'x509_san_dns';
key: unknown;
}

/**
 * Result of trust evaluation
 */
export interface TrustEvaluationResult {
trusted: boolean;
name?: string;
logo?: string;
metadata?: Record<string, unknown>;
}

/**
 * Trust evaluator function type for OpenID4VP
 */
export type OpenID4VPTrustEvaluator = (params: {
clientIdScheme: ClientIdScheme;
keyMaterial: OpenID4VPKeyMaterial;
requestUri?: string;
responseUri?: string;
}) => Promise<TrustEvaluationResult>;

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
 * Create an OpenID4VP trust evaluator.
 *
 * NOTE: This is a placeholder implementation. In production, trust evaluation
 * is performed by the wallet backend (via WebSocket transport) which delegates
 * to the configured AuthZEN PDP. This function is provided for future direct
 * client-side AuthZEN integration.
 *
 * @example
 * ```typescript
 * const evaluateTrust = createTrustEvaluator({
 *   httpClient: defaultHttpClient,
 *   backendUrl: BACKEND_URL,
 *   getAuthToken: () => sessionStorage.getItem('appToken'),
 *   tenantId: 'default',
 * });
 * ```
 */
export function createTrustEvaluator(_config: TrustEvaluatorConfig): OpenID4VPTrustEvaluator {
// Stub implementation - returns unknown trust status
// Real trust evaluation is done server-side via WebSocket transport
return async (_params): Promise<TrustEvaluationResult> => {
logger.warn('TrustEvaluator: Client-side trust evaluation not yet implemented. Using backend evaluation.');
return {
trusted: false,
metadata: { stub: true, message: 'Client-side AuthZEN not available; use WebSocket transport for trust evaluation' },
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
trusted: boolean;
name?: string;
logo?: string;
metadata?: Record<string, unknown>;
}

/**
 * Issuer trust evaluator function type.
 */
export type IssuerTrustEvaluator = (params: IssuerTrustEvaluationParams) => Promise<IssuerTrustResult>;

/**
 * Create an issuer trust evaluator.
 *
 * NOTE: This is a placeholder implementation. In production, trust evaluation
 * is performed by the wallet backend (via WebSocket transport) which delegates
 * to the configured AuthZEN PDP.
 */
export function createIssuerTrustEvaluator(_config: TrustEvaluatorConfig): IssuerTrustEvaluator {
// Stub implementation - returns unknown trust status
// Real trust evaluation is done server-side via WebSocket transport
return async (_params): Promise<IssuerTrustResult> => {
logger.warn('TrustEvaluator: Client-side issuer trust evaluation not yet implemented. Using backend evaluation.');
return {
trusted: false,
metadata: { stub: true, message: 'Client-side AuthZEN not available; use WebSocket transport for trust evaluation' },
};
};
}
