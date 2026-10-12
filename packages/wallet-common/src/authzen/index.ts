/**
 * AuthZEN client module for trust evaluation.
 *
 * This module provides a TypeScript client for interacting with the wallet backend's
 * AuthZEN proxy endpoints, enabling frontend-driven trust decisions for credential
 * issuers and verifiers.
 *
 * @example
 * ```typescript
 * import { AuthZENClient, TrustStatus } from 'wallet-common';
 *
 * const client = AuthZENClient({
 *   httpClient: defaultHttpClient,
 *   baseUrl: 'https://wallet-backend.example.com',
 *   getAuthToken: () => authService.getToken(),
 *   tenantId: 'tenant1',
 * });
 *
 * const result = await client.evaluateVerifier({
 *   clientId: 'did:web:verifier.example.com',
 *   keyMaterial: { type: 'jwk', key: jwk },
 * });
 *
 * if (result.ok && result.value.status === TrustStatus.TRUSTED) {
 *   console.log(`Trusted verifier: ${result.value.name}`);
 * }
 * ```
 */

export {
	// Client
	AuthZENClient,
	type AuthZENClientConfig,
	type EvaluateIssuerOptions,
	type EvaluateVerifierOptions,
	type IAuthZENClient,
	type KeyMaterial,
} from './AuthZENClient';
export type {
	AuthZENAction,
	AuthZENError,
	AuthZENEvaluationRequest,
	AuthZENEvaluationResponse,
	AuthZENEvaluationResponseContext,
	AuthZENResolveRequest,
	AuthZENResource,
	// Types
	AuthZENSubject,
	TrustInfo,
} from './types';
export {
	AuthZENErrorCode,
	TrustStatus,
} from './types';
