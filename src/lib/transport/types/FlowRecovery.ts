/**
 * Flow Recovery Types
 *
 * Type definitions for flow error handling, recovery, and retry.
 * Utility functions are in ../flowRecoveryUtils.ts.
 */

/**
 * Error categories for flow failures
 */
export type FlowErrorCategory = 'transient' | 'fatal' | 'user';

/**
 * Extended error information with recovery hints
 */
export interface FlowRecoverableError {
	/** Error code for programmatic handling */
	code: string;
	/** Human-readable error message */
	message: string;
	/** Error category determining recovery options */
	category: FlowErrorCategory;
	/** Whether the error is recoverable (derived from category) */
	recoverable: boolean;
	/** Suggested retry delay in ms (for transient errors) */
	retryDelayMs?: number;
	/** Maximum retry attempts recommended */
	maxRetries?: number;
	/** Original error for debugging */
	originalError?: unknown;
	/** Timestamp when error occurred */
	timestamp: number;
}

/**
 * Known error codes categorized by recoverability.
 *
 * Uses `as const` rather than an enum for better tree-shaking
 * and compatibility with string-based API error codes.
 */
export const FlowErrorCodes = {
	// Transient errors - may succeed on retry
	NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
	CONNECTION_LOST: 'CONNECTION_LOST',
	SIGN_TIMEOUT: 'SIGN_TIMEOUT',
	SERVER_OVERLOAD: 'SERVER_OVERLOAD',
	WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
	REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
	TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',

	// Fatal errors - require user action or new flow
	INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
	UNTRUSTED_ISSUER: 'UNTRUSTED_ISSUER',
	UNTRUSTED_VERIFIER: 'UNTRUSTED_VERIFIER',
	AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
	CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
	PROTOCOL_ERROR: 'PROTOCOL_ERROR',
	INVALID_REQUEST: 'INVALID_REQUEST',
	ACCESS_DENIED: 'ACCESS_DENIED',
	FLOW_EXPIRED: 'FLOW_EXPIRED',

	// User-initiated errors - not really errors
	USER_DECLINED: 'USER_DECLINED',
	USER_CANCELLED: 'USER_CANCELLED',

	// Unknown
	UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type FlowErrorCode = typeof FlowErrorCodes[keyof typeof FlowErrorCodes];

/**
 * Retry configuration
 */
export interface RetryConfig {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
}

/**
 * Default retry configuration for transient errors
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 10000,
	backoffMultiplier: 2,
};
