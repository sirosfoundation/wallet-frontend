/**
 * Flow Recovery Utilities
 *
 * Utility functions for handling flow errors, recovery, and retry.
 * Types are defined in ./types/FlowRecovery.ts.
 */

import {
	type OIDFlowErrorCategory,
	type OIDFlowRecoverableError,
	type OIDFlowErrorCode,
	type OIDFlowRetryConfig,
	OIDFlowErrorCodes,
	DEFAULT_OID_FLOW_RETRY_CONFIG,
} from '../types/OIDFlowRecovery';

/**
 * Map error codes to categories
 */
const ERROR_CATEGORY_MAP: Record<string, OIDFlowErrorCategory> = {
	// Transient
	[OIDFlowErrorCodes.NETWORK_TIMEOUT]: 'transient',
	[OIDFlowErrorCodes.CONNECTION_LOST]: 'transient',
	[OIDFlowErrorCodes.SIGN_TIMEOUT]: 'transient',
	[OIDFlowErrorCodes.SERVER_OVERLOAD]: 'transient',
	[OIDFlowErrorCodes.WEBSOCKET_ERROR]: 'transient',
	[OIDFlowErrorCodes.REQUEST_TIMEOUT]: 'transient',
	[OIDFlowErrorCodes.TEMPORARY_FAILURE]: 'transient',

	// Fatal
	[OIDFlowErrorCodes.INVALID_CREDENTIAL]: 'fatal',
	[OIDFlowErrorCodes.UNTRUSTED_ISSUER]: 'fatal',
	[OIDFlowErrorCodes.UNTRUSTED_VERIFIER]: 'fatal',
	[OIDFlowErrorCodes.AUTHORIZATION_FAILED]: 'fatal',
	[OIDFlowErrorCodes.CREDENTIAL_NOT_FOUND]: 'fatal',
	[OIDFlowErrorCodes.PROTOCOL_ERROR]: 'fatal',
	[OIDFlowErrorCodes.INVALID_REQUEST]: 'fatal',
	[OIDFlowErrorCodes.ACCESS_DENIED]: 'fatal',
	[OIDFlowErrorCodes.FLOW_EXPIRED]: 'fatal',

	// User
	[OIDFlowErrorCodes.USER_DECLINED]: 'user',
	[OIDFlowErrorCodes.USER_CANCELLED]: 'user',

	// Unknown defaults to fatal
	[OIDFlowErrorCodes.UNKNOWN_ERROR]: 'fatal',
};

/**
 * Classify an error code into a category
 */
export function getErrorCategory(code: string): OIDFlowErrorCategory {
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
export function createOIDFlowError(
	code: string,
	message: string,
	originalError?: unknown
): OIDFlowRecoverableError {
	const category = getErrorCategory(code);
	return {
		code,
		message,
		category,
		recoverable: category === 'transient',
		retryDelayMs: category === 'transient' ? DEFAULT_OID_FLOW_RETRY_CONFIG.initialDelayMs : undefined,
		maxRetries: category === 'transient' ? DEFAULT_OID_FLOW_RETRY_CONFIG.maxRetries : undefined,
		originalError,
		timestamp: Date.now(),
	};
}

/**
 * Map common error messages to error codes
 */
export function inferErrorCode(message: string, code?: string): OIDFlowErrorCode {
	// If a code is provided and known, use it
	if (code && code in ERROR_CATEGORY_MAP) {
		return code as OIDFlowErrorCode;
	}

	// Infer from message content
	const lowerMessage = message.toLowerCase();

	if (
		lowerMessage.includes('timeout') ||
		lowerMessage.includes('timed out')
	) {
		if (lowerMessage.includes('sign')) {
			return OIDFlowErrorCodes.SIGN_TIMEOUT;
		}
		return OIDFlowErrorCodes.NETWORK_TIMEOUT;
	}

	if (
		lowerMessage.includes('network') ||
		lowerMessage.includes('connection') ||
		lowerMessage.includes('disconnected')
	) {
		return OIDFlowErrorCodes.CONNECTION_LOST;
	}

	if (lowerMessage.includes('websocket')) {
		return OIDFlowErrorCodes.WEBSOCKET_ERROR;
	}

	if (
		lowerMessage.includes('overload') ||
		lowerMessage.includes('too many requests') ||
		lowerMessage.includes('503')
	) {
		return OIDFlowErrorCodes.SERVER_OVERLOAD;
	}

	if (
		lowerMessage.includes('untrusted') ||
		lowerMessage.includes('trust')
	) {
		if (lowerMessage.includes('issuer')) {
			return OIDFlowErrorCodes.UNTRUSTED_ISSUER;
		}
		if (lowerMessage.includes('verifier')) {
			return OIDFlowErrorCodes.UNTRUSTED_VERIFIER;
		}
	}

	if (
		lowerMessage.includes('invalid credential') ||
		lowerMessage.includes('credential invalid')
	) {
		return OIDFlowErrorCodes.INVALID_CREDENTIAL;
	}

	if (
		lowerMessage.includes('declined') ||
		lowerMessage.includes('rejected by user')
	) {
		return OIDFlowErrorCodes.USER_DECLINED;
	}

	if (
		lowerMessage.includes('cancel') ||
		lowerMessage.includes('abort')
	) {
		return OIDFlowErrorCodes.USER_CANCELLED;
	}

	if (
		lowerMessage.includes('expired') ||
		lowerMessage.includes('flow expired')
	) {
		return OIDFlowErrorCodes.FLOW_EXPIRED;
	}

	if (lowerMessage.includes('authorization')) {
		return OIDFlowErrorCodes.AUTHORIZATION_FAILED;
	}

	if (lowerMessage.includes('access denied')) {
		return OIDFlowErrorCodes.ACCESS_DENIED;
	}

	return OIDFlowErrorCodes.UNKNOWN_ERROR;
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
	attemptNumber: number,
	config: Partial<OIDFlowRetryConfig> = {}
): number {
	const resolved = { ...DEFAULT_OID_FLOW_RETRY_CONFIG, ...config };
	const delay = resolved.initialDelayMs * Math.pow(resolved.backoffMultiplier, attemptNumber - 1);
	return Math.min(delay, resolved.maxDelayMs);
}

/**
 * Check if we should retry based on attempt count and error
 */
export function shouldRetry(
	error: OIDFlowRecoverableError,
	attemptNumber: number,
	maxRetries = DEFAULT_OID_FLOW_RETRY_CONFIG.maxRetries
): boolean {
	if (!error.recoverable) {
		return false;
	}
	return attemptNumber < maxRetries;
}
