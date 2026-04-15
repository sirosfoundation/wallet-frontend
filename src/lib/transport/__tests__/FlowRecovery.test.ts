import { describe, it, expect } from 'vitest';
import {
	FlowErrorCodes,
	DEFAULT_RETRY_CONFIG,
} from '../types/FlowRecovery';
import {
	getErrorCategory,
	isRecoverableError,
	createFlowError,
	inferErrorCode,
	calculateRetryDelay,
	shouldRetry,
} from '../flowRecoveryUtils';

describe('FlowRecovery', () => {
	describe('getErrorCategory', () => {
		it('should categorize transient errors', () => {
			expect(getErrorCategory(FlowErrorCodes.NETWORK_TIMEOUT)).toBe('transient');
			expect(getErrorCategory(FlowErrorCodes.CONNECTION_LOST)).toBe('transient');
			expect(getErrorCategory(FlowErrorCodes.SIGN_TIMEOUT)).toBe('transient');
			expect(getErrorCategory(FlowErrorCodes.SERVER_OVERLOAD)).toBe('transient');
			expect(getErrorCategory(FlowErrorCodes.WEBSOCKET_ERROR)).toBe('transient');
			expect(getErrorCategory(FlowErrorCodes.REQUEST_TIMEOUT)).toBe('transient');
		});

		it('should categorize fatal errors', () => {
			expect(getErrorCategory(FlowErrorCodes.INVALID_CREDENTIAL)).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.UNTRUSTED_ISSUER)).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.UNTRUSTED_VERIFIER)).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.AUTHORIZATION_FAILED)).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.PROTOCOL_ERROR)).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.FLOW_EXPIRED)).toBe('fatal');
		});

		it('should categorize user errors', () => {
			expect(getErrorCategory(FlowErrorCodes.USER_DECLINED)).toBe('user');
			expect(getErrorCategory(FlowErrorCodes.USER_CANCELLED)).toBe('user');
		});

		it('should default unknown codes to fatal', () => {
			expect(getErrorCategory('UNKNOWN_CODE')).toBe('fatal');
			expect(getErrorCategory(FlowErrorCodes.UNKNOWN_ERROR)).toBe('fatal');
		});
	});

	describe('isRecoverableError', () => {
		it('should return true for transient errors', () => {
			expect(isRecoverableError(FlowErrorCodes.NETWORK_TIMEOUT)).toBe(true);
			expect(isRecoverableError(FlowErrorCodes.CONNECTION_LOST)).toBe(true);
			expect(isRecoverableError(FlowErrorCodes.WEBSOCKET_ERROR)).toBe(true);
		});

		it('should return false for fatal errors', () => {
			expect(isRecoverableError(FlowErrorCodes.INVALID_CREDENTIAL)).toBe(false);
			expect(isRecoverableError(FlowErrorCodes.UNTRUSTED_ISSUER)).toBe(false);
		});

		it('should return false for user errors', () => {
			expect(isRecoverableError(FlowErrorCodes.USER_DECLINED)).toBe(false);
			expect(isRecoverableError(FlowErrorCodes.USER_CANCELLED)).toBe(false);
		});
	});

	describe('createFlowError', () => {
		it('should create recoverable error for transient codes', () => {
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Connection timed out');

			expect(error.code).toBe(FlowErrorCodes.NETWORK_TIMEOUT);
			expect(error.message).toBe('Connection timed out');
			expect(error.category).toBe('transient');
			expect(error.recoverable).toBe(true);
			expect(error.retryDelayMs).toBeDefined();
			expect(error.maxRetries).toBeDefined();
			expect(error.timestamp).toBeDefined();
		});

		it('should create non-recoverable error for fatal codes', () => {
			const error = createFlowError(FlowErrorCodes.INVALID_CREDENTIAL, 'Credential validation failed');

			expect(error.code).toBe(FlowErrorCodes.INVALID_CREDENTIAL);
			expect(error.category).toBe('fatal');
			expect(error.recoverable).toBe(false);
			expect(error.retryDelayMs).toBeUndefined();
		});

		it('should include original error if provided', () => {
			const original = new Error('Original error');
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Wrapped', original);

			expect(error.originalError).toBe(original);
		});
	});

	describe('inferErrorCode', () => {
		it('should return provided code if known', () => {
			expect(inferErrorCode('Some message', FlowErrorCodes.NETWORK_TIMEOUT))
				.toBe(FlowErrorCodes.NETWORK_TIMEOUT);
		});

		it('should infer timeout errors', () => {
			expect(inferErrorCode('Request timed out')).toBe(FlowErrorCodes.NETWORK_TIMEOUT);
			expect(inferErrorCode('Connection timeout')).toBe(FlowErrorCodes.NETWORK_TIMEOUT);
			expect(inferErrorCode('Sign operation timed out')).toBe(FlowErrorCodes.SIGN_TIMEOUT);
		});

		it('should infer network/connection errors', () => {
			expect(inferErrorCode('Network error occurred')).toBe(FlowErrorCodes.CONNECTION_LOST);
			expect(inferErrorCode('Connection lost')).toBe(FlowErrorCodes.CONNECTION_LOST);
			expect(inferErrorCode('WebSocket disconnected')).toBe(FlowErrorCodes.CONNECTION_LOST);
		});

		it('should infer websocket errors', () => {
			expect(inferErrorCode('WebSocket error')).toBe(FlowErrorCodes.WEBSOCKET_ERROR);
		});

		it('should infer overload errors', () => {
			expect(inferErrorCode('Server overload')).toBe(FlowErrorCodes.SERVER_OVERLOAD);
			expect(inferErrorCode('Too many requests')).toBe(FlowErrorCodes.SERVER_OVERLOAD);
			expect(inferErrorCode('503 Service Unavailable')).toBe(FlowErrorCodes.SERVER_OVERLOAD);
		});

		it('should infer trust errors', () => {
			expect(inferErrorCode('Untrusted issuer')).toBe(FlowErrorCodes.UNTRUSTED_ISSUER);
			expect(inferErrorCode('Untrusted verifier')).toBe(FlowErrorCodes.UNTRUSTED_VERIFIER);
		});

		it('should infer user actions', () => {
			expect(inferErrorCode('User declined')).toBe(FlowErrorCodes.USER_DECLINED);
			expect(inferErrorCode('Operation cancelled by user')).toBe(FlowErrorCodes.USER_CANCELLED);
		});

		it('should infer flow expiration', () => {
			expect(inferErrorCode('Flow expired')).toBe(FlowErrorCodes.FLOW_EXPIRED);
		});

		it('should default to unknown for unrecognized messages', () => {
			expect(inferErrorCode('Some random error message')).toBe(FlowErrorCodes.UNKNOWN_ERROR);
		});
	});

	describe('calculateRetryDelay', () => {
		it('should return initial delay for first attempt', () => {
			const delay = calculateRetryDelay(1);
			expect(delay).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
		});

		it('should apply exponential backoff', () => {
			const config = { initialDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2 };

			expect(calculateRetryDelay(1, config)).toBe(1000);
			expect(calculateRetryDelay(2, config)).toBe(2000);
			expect(calculateRetryDelay(3, config)).toBe(4000);
			expect(calculateRetryDelay(4, config)).toBe(8000);
		});

		it('should cap at max delay', () => {
			const config = { initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 };

			expect(calculateRetryDelay(1, config)).toBe(1000);
			expect(calculateRetryDelay(2, config)).toBe(2000);
			expect(calculateRetryDelay(3, config)).toBe(4000);
			expect(calculateRetryDelay(4, config)).toBe(5000); // Capped at max
			expect(calculateRetryDelay(5, config)).toBe(5000);
		});
	});

	describe('shouldRetry', () => {
		it('should return true for recoverable errors under max retries', () => {
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');

			expect(shouldRetry(error, 1, 3)).toBe(true);
			expect(shouldRetry(error, 2, 3)).toBe(true);
		});

		it('should return false when at max retries', () => {
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');

			expect(shouldRetry(error, 3, 3)).toBe(false);
		});

		it('should return false for non-recoverable errors', () => {
			const error = createFlowError(FlowErrorCodes.INVALID_CREDENTIAL, 'Invalid');

			expect(shouldRetry(error, 1, 3)).toBe(false);
		});
	});
});
