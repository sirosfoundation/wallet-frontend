import { HttpClient } from '@sirosfoundation/http-client';
import { Result } from '@sirosfoundation/result';
import { AuthZENErrorCode, TrustStatus } from './resources';

/**
 * Configuration for the AuthZEN client.
 */
export interface AuthZENClientConfig {
	/**
	 * HTTP client for making requests.
	 */
	httpClient: HttpClient;

	/**
	 * Base URL of the wallet backend (e.g., 'https://wallet-backend.example.com').
	 */
	baseUrl: string;

	/**
	 * Function to retrieve the current auth token (JWT).
	 */
	getAuthToken: () => string | Promise<string>;

	/**
	 * Tenant ID for the X-Tenant-ID header.
	 */
	tenantId: string;

	/**
	 * Request timeout in milliseconds (default: 30000).
	 */
	timeout?: number;

	/**
	 * TTL for cached resolve responses in milliseconds (default: 300000 = 5 min).
	 * Set to 0 to disable caching.
	 */
	resolveCacheTtl?: number;
}

/**
 * Key material for trust evaluation.
 */
export interface KeyMaterial {
	/**
	 * Type of key material.
	 */
	type: 'jwk' | 'x5c' | 'x509_san_dns' | 'kid' | 'resolution';

	/**
	 * Key data. For JWK, this is the JWK object.
	 * For x5c, this is an array of base64-encoded certificates.
	 * For kid, this is the key ID string (requires resolution).
	 * For resolution, this is an empty array (resolution-only request).
	 */
	key: unknown | unknown[];
}

/**
 * Options for evaluating a verifier.
 */
export interface EvaluateVerifierOptions {
	/**
	 * The client_id of the verifier (may include scheme prefix).
	 */
	clientId: string;

	/**
	 * Key material extracted from the request JWT.
	 */
	keyMaterial: KeyMaterial;

	/**
	 * Additional context for policy evaluation.
	 */
	context?: Record<string, unknown>;
}

/**
 * Options for evaluating an issuer.
 */
export interface EvaluateIssuerOptions {
	/**
	 * The issuer identifier (typically the `iss` claim).
	 */
	issuerId: string;

	/**
	 * Key material from the issuer metadata or credential JWT.
	 */
	keyMaterial: KeyMaterial;

	/**
	 * Additional context for policy evaluation.
	 */
	context?: Record<string, unknown>;
}

/**
 * AuthZEN client interface.
 */
export interface IAuthZENClient {
	/**
	 * Send a raw AuthZEN evaluation request.
	 */
	evaluate(
		request: AuthZENEvaluationRequest,
	): Promise<Result<AuthZENEvaluationResponse, AuthZENError>>;

	/**
	 * Resolve metadata for a subject (DID document, entity config, etc.).
	 *
	 * @param subjectId - The subject identifier (DID, URL, etc.)
	 * @param options - Optional subject_type and resource_type hints
	 */
	resolve(
		subjectId: string,
		options?: {
			subjectType?: string;
			resourceType?: string;
			useCache?: boolean;
		},
	): Promise<Result<AuthZENEvaluationResponse, AuthZENError>>;

	/**
	 * Evaluate a verifier's trust status.
	 */
	evaluateVerifier(
		options: EvaluateVerifierOptions,
	): Promise<Result<TrustInfo, AuthZENError>>;

	/**
	 * Evaluate an issuer's trust status.
	 */
	evaluateIssuer(
		options: EvaluateIssuerOptions,
	): Promise<Result<TrustInfo, AuthZENError>>;
}
/**
 * AuthZEN types for trust evaluation.
 *
 * These types mirror the AuthZEN Trust Registry Profile specification
 * as implemented by go-trust.
 *
 * @see https://openid.github.io/authzen/
 */

/**
 * Subject identifies the entity being evaluated (issuer, verifier, etc.).
 */
export interface AuthZENSubject {
	/**
	 * Type of the subject. Per the AuthZEN Trust Registry Profile, this should
	 * always be 'key' for trust evaluation requests.
	 */
	type: 'key' | string;

	/**
	 * Identifier of the subject. This is typically:
	 * - A DID (e.g., 'did:web:example.com')
	 * - An HTTPS URL for OIDF entities (e.g., 'https://issuer.example.com')
	 * - A client_id value (e.g., 'x509_san_dns:verifier.example.com')
	 */
	id: string;
}

/**
 * Resource contains the key material being evaluated.
 */
export interface AuthZENResource {
	/**
	 * Type of key material:
	 * - 'jwk': JSON Web Key
	 * - 'x5c': X.509 certificate chain (base64-encoded DER)
	 * - 'x509_san_dns': X.509 with SAN DNS name validation
	 * - 'resolution': Resolution-only request (no key validation)
	 * - 'credential_issuer': Issuer metadata resolution via OpenID4VCI well-known
	 */
	type: 'jwk' | 'x5c' | 'x509_san_dns' | 'resolution' | 'credential_issuer' | string;

	/**
	 * Identifier matching the subject.id.
	 */
	id: string;

	/**
	 * Key material. For JWK, this is an array containing the JWK object.
	 * For x5c, this is an array of base64-encoded DER certificates.
	 * For resolution, this is an empty array (resolution-only request).
	 */
	key?: unknown[];
}

/**
 * Action specifies the role/action being evaluated.
 */
export interface AuthZENAction {
	/**
	 * Name of the action/role:
	 * - 'credential-issuer': Credential issuer validation
	 * - 'credential-verifier': Verifier/RP validation
	 * - 'wallet-provider': Wallet provider attestation
	 * - 'pid-provider': PID provider validation
	 * - 'mdl-issuer': mDL issuer validation
	 *
	 * When empty/undefined, indicates a resolution-only request.
	 */
	name: string;
}

/**
 * EvaluationRequest is sent to the AuthZEN PDP for trust evaluation.
 */
export interface AuthZENEvaluationRequest {
	/**
	 * Subject being evaluated (issuer, verifier, etc.).
	 */
	subject: AuthZENSubject;

	/**
	 * Resource containing key material for validation.
	 */
	resource: AuthZENResource;

	/**
	 * Action/role constraint. Optional for resolution-only requests.
	 */
	action?: AuthZENAction;

	/**
	 * Additional context for policy evaluation.
	 * Can include trust framework constraints, allowed domains, etc.
	 */
	context?: Record<string, unknown>;
}

/**
 * EvaluationResponseContext contains metadata about the trust decision.
 */
export interface AuthZENEvaluationResponseContext {
	/**
	 * Identifier echoed from the request.
	 */
	id?: string;

	/**
	 * Whether the subject was successfully resolved (metadata fetched).
	 */
	resolved?: boolean;

	/**
	 * Reason for the decision. Includes policy information for debugging.
	 */
	reason?: Record<string, unknown>;

	/**
	 * Trust metadata returned by the PDP. This can be:
	 * - A DID Document (for did: subjects)
	 * - An OIDF Entity Configuration (for https:// subjects)
	 * - Issuer metadata (for credential_issuer resolution)
	 * - Certificate chain information (for x5c resources)
	 */
	trust_metadata?: Record<string, unknown>;

	/**
	 * Whether the metadata was cryptographically validated (e.g. signed_metadata
	 * JWT verified, or application/jwt response verified with a trusted key).
	 * Set by the issuer-url registry when resolving credential issuer metadata.
	 */
	validated?: boolean;
}

/**
 * EvaluationResponse is returned by the AuthZEN PDP.
 */
export interface AuthZENEvaluationResponse {
	/**
	 * Whether the subject is trusted for the requested action.
	 */
	decision: boolean;

	/**
	 * Additional context about the decision.
	 */
	context?: AuthZENEvaluationResponseContext;
}

/**
 * ResolveRequest is a simplified request for metadata resolution only.
 */
export interface AuthZENResolveRequest {
	/**
	 * Subject ID to resolve (DID, URL, etc.).
	 */
	subject_id: string;

	/**
	 * Subject type hint (e.g. 'key', 'url'). Defaults to 'key' on the backend.
	 */
	subject_type?: string;

	/**
	 * Resource type for the resolution (e.g. 'credential_issuer', 'openid_provider').
	 * Determines which well-known metadata endpoint to query for URL subjects.
	 */
	resource_type?: string;
}



/**
 * Error response from the AuthZEN proxy.
 */
export interface AuthZENError {
	/**
	 * Error code.
	 */
	error: AuthZENErrorCode | string;

	/**
	 * Human-readable error description.
	 */
	details?: string;
}

/**
 * Resolved trust information for an entity.
 */
export interface TrustInfo {
	/**
	 * Trust decision from the PDP.
	 */
	status: TrustStatus;

	/**
	 * Human-readable name of the entity (if resolved).
	 */
	name?: string;

	/**
	 * Logo/icon URL for the entity (if available).
	 */
	logo?: string;

	/**
	 * Trust metadata (DID doc, entity config, etc.).
	 */
	metadata?: unknown;

	/**
	 * Whether the metadata was cryptographically validated (e.g. signed JWT
	 * verified). Propagated from the PDP response context or reason.
	 */
	validated?: boolean;

	/**
	 * Error if trust evaluation failed.
	 */
	error?: AuthZENError;
}
