/**
 * Retry Transport Wrapper
 *
 * Wraps a transport with retry capabilities for transient errors.
 * Integrates with FlowStateManager for state persistence.
 */

import type { IFlowTransport } from './types/IFlowTransport';
import type { FlowRequest, FlowResponse, FlowProgressEvent } from './types/FlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult } from './types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult } from './types/OID4VPTypes';
import {
	createFlowError,
	inferErrorCode,
	calculateRetryDelay,
	DEFAULT_RETRY_CONFIG,
	type FlowRecoverableError,
	type RetryConfig,
} from './types/FlowRecovery';
import {
	FlowStateManager,
	getFlowStateManager,
	type FlowProtocol,
	type FlowCheckpoint,
	type FlowState,
} from './FlowStateManager';
import { logger } from '@/logger';

// Re-export RetryConfig for convenience
export type { RetryConfig } from './types/FlowRecovery';

/**
 * Retry event for progress tracking
 */
export interface RetryEvent {
	flowId: string;
	attemptNumber: number;
	maxRetries: number;
	error: FlowRecoverableError;
	nextRetryIn: number;
}

/**
 * Callback types
 */
export type RetryCallback = (event: RetryEvent) => void;
export type RecoveryCallback = (state: FlowState) => void;

/**
 * Options for the retry wrapper
 */
export interface RetryTransportOptions {
	/** Custom retry configuration */
	retryConfig?: Partial<RetryConfig>;
	/** Flow state manager instance (uses default if not provided) */
	stateManager?: FlowStateManager;
	/** Callback when a retry is about to happen */
	onRetry?: RetryCallback;
	/** Callback when a flow can be recovered */
	onRecoverable?: RecoveryCallback;
}

/**
 * Result type that includes recovery information
 */
export interface RecoverableFlowResult<T> {
	result: T;
	flowState?: FlowState;
	retryInfo?: {
		attemptsTaken: number;
		canRetry: boolean;
		nextRetryDelay?: number;
	};
}

/**
 * Retry Transport Wrapper - adds retry capabilities to any IFlowTransport
 */
export class RetryTransportWrapper implements IFlowTransport {
	private transport: IFlowTransport;
	private config: RetryConfig;
	private stateManager: FlowStateManager;
	private onRetry?: RetryCallback;
	private onRecoverable?: RecoveryCallback;

	// Track active flow IDs for this session
	private activeFlows = new Map<string, FlowState>();

	constructor(transport: IFlowTransport, options: RetryTransportOptions = {}) {
		this.transport = transport;
		this.config = {
			...DEFAULT_RETRY_CONFIG,
			...options.retryConfig,
		};
		this.stateManager = options.stateManager ?? getFlowStateManager();
		this.onRetry = options.onRetry;
		this.onRecoverable = options.onRecoverable;
	}

	// ===== Connection Methods (delegated) =====

	async connect(): Promise<void> {
		return this.transport.connect();
	}

	async disconnect(): Promise<void> {
		return this.transport.disconnect();
	}

	isConnected(): boolean {
		return this.transport.isConnected();
	}

	// ===== OID4VCI Flow with Retry =====

	async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		const entryUri = params.credentialOfferUri ?? params.credentialOffer ?? '';

		// Credential offers (phase 1) may be single-use: if the backend has already
		// consumed the offer and the connection dropped before we received the response,
		// retrying with the same URI could fail or cause double-processing.
		// Authorization codes (phase 3) are single-use at the authorization server.
		// Both phases must not be automatically retried; users should start over instead.
		const allowAutoRetry = !params.credentialOfferUri && !params.credentialOffer && !params.authorizationCode;

		return this.executeWithRetry<OID4VCIFlowResult>(
			'oid4vci',
			entryUri,
			() => this.transport.startOID4VCIFlow(params),
			this.getOID4VCICheckpoint(params),
			allowAutoRetry
		);
	}

	private getOID4VCICheckpoint(params: OID4VCIFlowParams): FlowCheckpoint {
		if (params.authorizationCode) return 'authorization_completed';
		if (params.holderBinding) return 'consent_given';
		if (params.preAuthorizedCode) return 'consent_given';
		if (params.credentialOfferUri || params.credentialOffer) return 'initialized';
		return 'initialized';
	}

	// ===== OID4VP Flow with Retry =====

	async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
		const entryUri = params.authorizationRequestUri ?? '';
		return this.executeWithRetry<OID4VPFlowResult>(
			'oid4vp',
			entryUri,
			() => this.transport.startOID4VPFlow(params),
			this.getOID4VPCheckpoint(params)
		);
	}

	private getOID4VPCheckpoint(params: OID4VPFlowParams): FlowCheckpoint {
		if (params.selectedCredentials) return 'selection_made';
		if (params.authorizationRequestUri) return 'initialized';
		return 'initialized';
	}

	// ===== Generic Request with Retry =====

	async request<T>(flowRequest: FlowRequest): Promise<FlowResponse<T>> {
		try {
			// Use type:action as entryUri to avoid exposing sensitive payload data
			const entryUri = `${flowRequest.type}:${flowRequest.action}`;
			return await this.executeWithRetry<FlowResponse<T>>(
				'oid4vci', // Generic flows default to oid4vci protocol
				entryUri,
				() => this.transport.request<T>(flowRequest),
				'initialized'
			);
		} catch (error) {
			return {
				success: false,
				error: {
					code: 'RETRY_EXHAUSTED',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
			};
		}
	}

	// ===== Event Subscriptions (delegated) =====

	onProgress(callback: (event: FlowProgressEvent) => void): () => void {
		return this.transport.onProgress(callback);
	}

	onError(callback: (error: Error) => void): () => void {
		return this.transport.onError(callback);
	}

	// ===== Flow Recovery =====

	/**
	 * Get all flows that can be resumed
	 */
	getResumableFlows(): FlowState[] {
		return this.stateManager.getResumableFlows();
	}

	/**
	 * Get state for a specific flow
	 */
	getFlowState(flowId: string): FlowState | null {
		return this.stateManager.get(flowId);
	}

	/**
	 * Check if a flow can be retried
	 */
	canRetryFlow(flowId: string): boolean {
		return this.stateManager.canRetry(flowId, this.config.maxRetries);
	}

	/**
	 * Prepare a flow for manual retry
	 * Returns the state ready for retry, or null if not possible
	 */
	prepareFlowRetry(flowId: string): FlowState | null {
		const state = this.stateManager.prepareRetry(flowId);
		if (state) {
			this.activeFlows.set(flowId, state);
		}
		return state;
	}

	/**
	 * Cancel a flow
	 */
	cancelFlow(flowId: string): void {
		this.stateManager.cancel(flowId);
		this.activeFlows.delete(flowId);
	}

	/**
	 * Clear all flow states (e.g., on logout)
	 */
	clearAllFlows(): void {
		this.stateManager.clearAll();
		this.activeFlows.clear();
	}

	// ===== Private Methods =====

	/**
	 * Execute a flow operation with automatic retry for recoverable errors.
	 *
	 * @param allowAutoRetry - When false, automatic retry is disabled for this operation.
	 *   Use false for operations whose parameters may be single-use (e.g. credential
	 *   offer URIs, authorization codes) to avoid double-processing on reconnect.
	 *   The onRecoverable callback is still invoked so the UI can offer manual retry.
	 */
	private async executeWithRetry<T>(
		protocol: FlowProtocol,
		entryUri: string,
		operation: () => Promise<T>,
		checkpoint: FlowCheckpoint,
		allowAutoRetry: boolean = true
	): Promise<T> {
		const flowId = crypto.randomUUID();
		let state = this.stateManager.create(flowId, protocol, entryUri, { checkpoint });
		this.activeFlows.set(flowId, state);

		// When auto-retry is disabled (e.g. single-use params), cap retries at 0.
		const effectiveMaxRetries = allowAutoRetry ? this.config.maxRetries : 0;

		let attemptNumber = 0;
		let lastError: FlowRecoverableError | undefined;

		while (attemptNumber <= effectiveMaxRetries) {
			attemptNumber++;

			// On retries, ensure the underlying transport is connected before
			// attempting the operation. The WebSocket transport reconnects
			// asynchronously in the background; calling connect() here waits for
			// that reconnect to complete (or fails fast if it cannot reconnect).
			if (attemptNumber > 1 && !this.transport.isConnected()) {
				try {
					await this.transport.connect();
				} catch (connectError) {
					const errorMessage = connectError instanceof Error ? connectError.message : 'Reconnection failed';
					const recoverableError = this.classifyError(undefined, errorMessage);
					state = this.stateManager.recordError(flowId, recoverableError) ?? state;
					if (recoverableError.recoverable && this.stateManager.canRetry(flowId, effectiveMaxRetries)) {
						this.emitRecoverable(state);
					}
					throw connectError;
				}
			}

			try {
				// Update checkpoint before operation
				state = this.stateManager.updateCheckpoint(flowId, checkpoint) ?? state;

				// Execute the operation
				const result = await operation();

				// Check if result indicates an error
				const flowError = this.extractError(result);
				if (flowError) {
					const recoverableError = this.classifyError(flowError.code, flowError.message);

					if (recoverableError.recoverable && attemptNumber < effectiveMaxRetries) {
						lastError = recoverableError;
						state = this.stateManager.recordError(flowId, recoverableError) ?? state;

						const delay = calculateRetryDelay(attemptNumber, this.config);
						this.emitRetry(flowId, attemptNumber, recoverableError, delay);

						await this.sleep(delay);
						continue;
					}

					// Non-recoverable or exhausted retries
					state = this.stateManager.recordError(flowId, recoverableError) ?? state;

					// Only notify recoverable if manual retry is actually possible
					// (i.e., hook's canRetry would be true based on current retry count)
					if (recoverableError.recoverable && this.stateManager.canRetry(flowId, effectiveMaxRetries)) {
						this.emitRecoverable(state);
					}
				}

				// Success or fatal error - clean up on success
				if (!flowError) {
					this.stateManager.complete(flowId);
					this.activeFlows.delete(flowId);
				}

				return result;
			} catch (error) {
				// Handle thrown errors
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				const recoverableError = this.classifyError(undefined, errorMessage);

				if (recoverableError.recoverable && attemptNumber < effectiveMaxRetries) {
					lastError = recoverableError;
					state = this.stateManager.recordError(flowId, recoverableError) ?? state;

					const delay = calculateRetryDelay(attemptNumber, this.config);
					this.emitRetry(flowId, attemptNumber, recoverableError, delay);

					await this.sleep(delay);
					continue;
				}

				// Non-recoverable or exhausted retries
				state = this.stateManager.recordError(flowId, recoverableError) ?? state;

				// Only notify recoverable if manual retry is actually possible
				if (recoverableError.recoverable && this.stateManager.canRetry(flowId, effectiveMaxRetries)) {
					this.emitRecoverable(state);
				}

				throw error;
			}
		}

		// Should not reach here, but handle it
		throw new Error(`Flow failed after ${attemptNumber} attempts: ${lastError?.message}`);
	}

	/**
	 * Extract error from a flow result
	 */
	private extractError(result: unknown): { code: string; message: string } | null {
		if (!result || typeof result !== 'object') return null;

		const r = result as Record<string, unknown>;

		// Direct error field
		if (r.error && typeof r.error === 'object') {
			const err = r.error as Record<string, unknown>;
			return {
				code: (err.code as string) ?? 'UNKNOWN_ERROR',
				message: (err.message as string) ?? 'Unknown error',
			};
		}

		// Success: false indicates error
		if (r.success === false) {
			return {
				code: (r.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
				message: (r.error as { message?: string })?.message ?? 'Flow failed',
			};
		}

		return null;
	}

	/**
	 * Classify an error as recoverable or not
	 */
	private classifyError(code: string | undefined, message: string): FlowRecoverableError {
		const inferredCode = inferErrorCode(message, code);
		return createFlowError(inferredCode, message);
	}

	/**
	 * Emit a retry event
	 */
	private emitRetry(
		flowId: string,
		attemptNumber: number,
		error: FlowRecoverableError,
		nextRetryIn: number
	): void {
		logger.debug(
			`Flow ${flowId} retry ${attemptNumber}/${this.config.maxRetries} in ${nextRetryIn}ms:`,
			error.message
		);

		if (this.onRetry) {
			this.onRetry({
				flowId,
				attemptNumber,
				maxRetries: this.config.maxRetries,
				error,
				nextRetryIn,
			});
		}
	}

	/**
	 * Emit a recoverable event (manual retry possible)
	 */
	private emitRecoverable(state: FlowState): void {
		logger.debug(`Flow ${state.flowId} is recoverable, manual retry available`);

		if (this.onRecoverable) {
			this.onRecoverable(state);
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * Create a retry-wrapped transport
 */
export function withRetry(
	transport: IFlowTransport,
	options?: RetryTransportOptions
): RetryTransportWrapper {
	return new RetryTransportWrapper(transport, options);
}
