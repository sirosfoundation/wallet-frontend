/**
 * Flow Recovery Types
 *
 * Types and utilities for handling flow errors, recovery, and retry.
 * Distinguishes between recoverable (transient) and fatal errors to
 * provide appropriate UX options.
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
 * Known error codes categorized by recoverability
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

/**
 * Map error codes to categories
 */
const ERROR_CATEGORY_MAP: Record<string, FlowErrorCategory> = {
	// Transient
	[FlowErrorCodes.NETWORK_TIMEOUT]: 'transient',
	[FlowErrorCodes.CONNECTION_LOST]: 'transient',
	[FlowErrorCodes.SIGN_TIMEOUT]: 'transient',
	[FlowErrorCodes.SERVER_OVERLOAD]: 'transient',
	[FlowErrorCodes.WEBSOCKET_ERROR]: 'transient',
	[FlowErrorCodes.REQUEST_TIMEOUT]: 'transient',
	[FlowErrorCodes.TEMPORARY_FAILURE]: 'transient',

	// Fatal
	[FlowErrorCodes.INVALID_CREDENTIAL]: 'fatal',
	[FlowErrorCodes.UNTRUSTED_ISSUER]: 'fatal',
	[FlowErrorCodes.UNTRUSTED_VERIFIER]: 'fatal',
	[FlowErrorCodes.AUTHORIZATION_FAILED]: 'fatal',
	[FlowErrorCodes.CREDENTIAL_NOT_FOUND]: 'fatal',
	[FlowErrorCodes.PROTOCOL_ERROR]: 'fatal',
	[FlowErrorCodes.INVALID_REQUEST]: 'fatal',
	[FlowErrorCodes.ACCESS_DENIED]: 'fatal',
	[FlowErrorCodes.FLOW_EXPIRED]: 'fatal',

	// User
	[FlowErrorCodes.USER_DECLINED]: 'user',
	[FlowErrorCodes.USER_CANCELLED]: 'user',

	// Unknown defaults to fatal
	[FlowErrorCodes.UNKNOWN_ERROR]: 'fatal',
};

/**
 * Classify an error code into a category
 */
export function getErrorCategory(code: string): FlowErrorCategory {
	return ERROR_CATEGORY_MAP[code] ?? 'fatal';
}

/**
 * Check if an error is recoverable (can be retried)
 */
export function isRecoverableError(code: string): boolean {
	return getErrorCategory(code) === 'transient';
}

/**
 * Create a recoverable error object from a basic error
 */
export function createFlowError(
	code: string,
	message: string,
	originalError?: unknown
): FlowRecoverableError {
	const category = getErrorCategory(code);
	return {
		code,
		message,
		category,
		recoverable: category === 'transient',
		retryDelayMs: category === 'transient' ? DEFAULT_RETRY_CONFIG.initialDelayMs : undefined,
		maxRetries: category === 'transient' ? DEFAULT_RETRY_CONFIG.maxRetries : undefined,
		originalError,
		timestamp: Date.now(),
	};
}

/**
 * Map common error messages to error codes
 */
export function inferErrorCode(message: string, code?: string): FlowErrorCode {
	// If a code is provided and known, use it
	if (code && code in ERROR_CATEGORY_MAP) {
		return code as FlowErrorCode;
	}

	// Infer from message content
	const lowerMessage = message.toLowerCase();

	if (
		lowerMessage.includes('timeout') ||
		lowerMessage.includes('timed out')
	) {
		if (lowerMessage.includes('sign')) {
			return FlowErrorCodes.SIGN_TIMEOUT;
		}
		return FlowErrorCodes.NETWORK_TIMEOUT;
	}

	if (
		lowerMessage.includes('network') ||
		lowerMessage.includes('connection') ||
		lowerMessage.includes('disconnected')
	) {
		return FlowErrorCodes.CONNECTION_LOST;
	}

	if (lowerMessage.includes('websocket')) {
		return FlowErrorCodes.WEBSOCKET_ERROR;
	}

	if (
		lowerMessage.includes('overload') ||
		lowerMessage.includes('too many requests') ||
		lowerMessage.includes('503')
	) {
		return FlowErrorCodes.SERVER_OVERLOAD;
	}

	if (
		lowerMessage.includes('untrusted') ||
		lowerMessage.includes('trust')
	) {
		if (lowerMessage.includes('issuer')) {
			return FlowErrorCodes.UNTRUSTED_ISSUER;
		}
		if (lowerMessage.includes('verifier')) {
			return FlowErrorCodes.UNTRUSTED_VERIFIER;
		}
	}

	if (
		lowerMessage.includes('invalid credential') ||
		lowerMessage.includes('credential invalid')
	) {
		return FlowErrorCodes.INVALID_CREDENTIAL;
	}

	if (
		lowerMessage.includes('declined') ||
		lowerMessage.includes('rejected by user')
	) {
		return FlowErrorCodes.USER_DECLINED;
	}

	if (
		lowerMessage.includes('cancel') ||
		lowerMessage.includes('abort')
	) {
		return FlowErrorCodes.USER_CANCELLED;
	}

	if (
		lowerMessage.includes('expired') ||
		lowerMessage.includes('flow expired')
	) {
		return FlowErrorCodes.FLOW_EXPIRED;
	}

	if (lowerMessage.includes('authorization')) {
		return FlowErrorCodes.AUTHORIZATION_FAILED;
	}

	if (lowerMessage.includes('access denied')) {
		return FlowErrorCodes.ACCESS_DENIED;
	}

	return FlowErrorCodes.UNKNOWN_ERROR;
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
	attemptNumber: number,
	config = DEFAULT_RETRY_CONFIG
): number {
	const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 1);
	return Math.min(delay, config.maxDelayMs);
}

/**
 * Check if we should retry based on attempt count and error
 */
export function shouldRetry(
	error: FlowRecoverableError,
	attemptNumber: number,
	maxRetries = DEFAULT_RETRY_CONFIG.maxRetries
): boolean {
	if (!error.recoverable) {
		return false;
	}
	return attemptNumber < maxRetries;
}
