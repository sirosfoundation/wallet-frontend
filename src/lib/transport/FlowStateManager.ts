/**
 * Flow State Manager
 *
 * Persists flow state to sessionStorage for recovery after connection issues.
 * Each flow gets a unique ID and its state is tracked through checkpoints.
 */

import { logger } from '@/logger';
import type { FlowRecoverableError } from './types/FlowRecovery';

const STORAGE_KEY_PREFIX = 'wallet_flow_state_';
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes - matches backend flow timeout

/**
 * Flow protocol type
 */
export type FlowProtocol = 'oid4vci' | 'oid4vp';

/**
 * Flow checkpoint stages
 */
export type FlowCheckpoint =
	// Common
	| 'initialized'
	| 'connecting'
	| 'connected'
	// OID4VCI stages
	| 'metadata_fetched'
	| 'awaiting_consent'
	| 'consent_given'
	| 'authorization_started'
	| 'authorization_completed'
	| 'awaiting_proof'
	| 'proof_submitted'
	| 'credential_received'
	// OID4VP stages
	| 'request_fetched'
	| 'awaiting_selection'
	| 'selection_made'
	| 'presentation_submitted'
	| 'response_received'
	// Terminal states
	| 'completed'
	| 'failed'
	| 'cancelled';

/**
 * Persisted flow state
 */
export interface FlowState {
	/** Unique flow identifier */
	flowId: string;
	/** Flow protocol */
	protocol: FlowProtocol;
	/** Current checkpoint */
	checkpoint: FlowCheckpoint;
	/** Entry point URI (offer or request) */
	entryUri: string;
	/** When flow started */
	startedAt: number;
	/** Last update timestamp */
	updatedAt: number;
	/** Number of retry attempts */
	retryCount: number;
	/** Last error (if any) */
	lastError?: FlowRecoverableError;
	/** Protocol-specific state data */
	data: Record<string, unknown>;
}

/**
 * Options for flow recovery
 */
export interface FlowRecoveryOptions {
	/** Handler to call when flow can be resumed */
	onResumable?: (state: FlowState) => void;
	/** Custom max age for flow states */
	maxAgeMs?: number;
}

/**
 * Flow State Manager - handles persistence and recovery of flow states
 */
export class FlowStateManager {
	private options: Required<FlowRecoveryOptions>;

	constructor(options: FlowRecoveryOptions = {}) {
		this.options = {
			onResumable: options.onResumable ?? (() => {}),
			maxAgeMs: options.maxAgeMs ?? MAX_AGE_MS,
		};
	}

	/**
	 * Create and persist a new flow state
	 */
	create(
		flowId: string,
		protocol: FlowProtocol,
		entryUri: string,
		initialData: Record<string, unknown> = {}
	): FlowState {
		const now = Date.now();
		const state: FlowState = {
			flowId,
			protocol,
			checkpoint: 'initialized',
			entryUri,
			startedAt: now,
			updatedAt: now,
			retryCount: 0,
			data: initialData,
		};

		this.save(state);
		return state;
	}

	/**
	 * Update flow checkpoint
	 */
	updateCheckpoint(
		flowId: string,
		checkpoint: FlowCheckpoint,
		additionalData?: Record<string, unknown>
	): FlowState | null {
		const state = this.get(flowId);
		if (!state) {
			logger.warn('Cannot update checkpoint: flow not found', flowId);
			return null;
		}

		state.checkpoint = checkpoint;
		state.updatedAt = Date.now();
		if (additionalData) {
			state.data = { ...state.data, ...additionalData };
		}

		this.save(state);
		return state;
	}

	/**
	 * Record an error for a flow
	 */
	recordError(flowId: string, error: FlowRecoverableError): FlowState | null {
		const state = this.get(flowId);
		if (!state) {
			return null;
		}

		state.lastError = error;
		state.updatedAt = Date.now();

		if (error.recoverable) {
			state.retryCount++;
		} else {
			state.checkpoint = 'failed';
		}

		this.save(state);
		return state;
	}

	/**
	 * Mark flow as completed and clean up
	 */
	complete(flowId: string): void {
		const state = this.get(flowId);
		if (state) {
			state.checkpoint = 'completed';
			state.updatedAt = Date.now();
			// Keep briefly for completion confirmation, then delete
			this.save(state);
			// Defer cleanup - use try-catch as storage may already be cleared
			// Also guard for SSR where setTimeout behavior may differ
			if (typeof window !== 'undefined') {
				setTimeout(() => {
					try {
						this.delete(flowId);
					} catch {
						// Storage may already be cleared
					}
				}, 5000);
			}
		}
	}

	/**
	 * Mark flow as cancelled and clean up
	 */
	cancel(flowId: string): void {
		this.delete(flowId);
	}

	/**
	 * Get a flow state by ID
	 */
	get(flowId: string): FlowState | null {
		const key = STORAGE_KEY_PREFIX + flowId;
		try {
			const stored = sessionStorage.getItem(key);
			if (!stored) {
				return null;
			}

			const state = JSON.parse(stored) as FlowState;

			// Check if expired
			if (Date.now() - state.startedAt > this.options.maxAgeMs) {
				this.delete(flowId);
				return null;
			}

			return state;
		} catch (e) {
			logger.error('Failed to read flow state:', e);
			return null;
		}
	}

	/**
	 * Find all active (non-terminal) flow states
	 */
	getActiveFlows(): FlowState[] {
		const flows: FlowState[] = [];
		const terminalStates: FlowCheckpoint[] = ['completed', 'failed', 'cancelled'];

		try {
			// Collect keys first to avoid mutation during iteration
			// (this.get() may delete expired entries)
			const keys: string[] = [];
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (key?.startsWith(STORAGE_KEY_PREFIX)) {
					keys.push(key);
				}
			}

			for (const key of keys) {
				const flowId = key.slice(STORAGE_KEY_PREFIX.length);
				const state = this.get(flowId);
				if (state && !terminalStates.includes(state.checkpoint)) {
					flows.push(state);
				}
			}
		} catch (e) {
			logger.error('Failed to enumerate flow states:', e);
		}

		return flows;
	}

	/**
	 * Find flows that can be resumed (have recoverable errors)
	 */
	getResumableFlows(): FlowState[] {
		return this.getActiveFlows().filter(
			state => state.lastError?.recoverable === true
		);
	}

	/**
	 * Check if a flow can be retried
	 */
	canRetry(flowId: string, maxRetries = 3): boolean {
		const state = this.get(flowId);
		if (!state) {
			return false;
		}
		if (!state.lastError?.recoverable) {
			return false;
		}
		return state.retryCount < maxRetries;
	}

	/**
	 * Prepare flow for retry (clear error and roll back to safe checkpoint)
	 * Note: retryCount is incremented by recordError(), not here
	 */
	prepareRetry(flowId: string): FlowState | null {
		const state = this.get(flowId);
		if (!state) {
			return null;
		}

		// Roll back to last safe checkpoint
		state.checkpoint = this.getRetryCheckpoint(state);
		state.lastError = undefined;
		state.updatedAt = Date.now();

		this.save(state);
		return state;
	}

	/**
	 * Delete a flow state
	 */
	delete(flowId: string): void {
		const key = STORAGE_KEY_PREFIX + flowId;
		try {
			sessionStorage.removeItem(key);
		} catch (e) {
			logger.error('Failed to delete flow state:', e);
		}
	}

	/**
	 * Clear all flow states (e.g., on logout)
	 */
	clearAll(): void {
		const keysToDelete: string[] = [];
		try {
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (key?.startsWith(STORAGE_KEY_PREFIX)) {
					keysToDelete.push(key);
				}
			}
			keysToDelete.forEach(key => sessionStorage.removeItem(key));
		} catch (e) {
			logger.error('Failed to clear flow states:', e);
		}
	}

	/**
	 * Clean up expired flow states
	 */
	cleanupExpired(): void {
		try {
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (key?.startsWith(STORAGE_KEY_PREFIX)) {
					const flowId = key.slice(STORAGE_KEY_PREFIX.length);
					// get() will delete if expired
					this.get(flowId);
				}
			}
		} catch (e) {
			logger.error('Failed to cleanup expired flows:', e);
		}
	}

	/**
	 * Get state data for a specific protocol
	 */
	getData<T = Record<string, unknown>>(flowId: string): T | null {
		const state = this.get(flowId);
		return state?.data as T | null;
	}

	/**
	 * Update state data
	 */
	updateData(flowId: string, data: Record<string, unknown>): FlowState | null {
		const state = this.get(flowId);
		if (!state) {
			return null;
		}

		state.data = { ...state.data, ...data };
		state.updatedAt = Date.now();
		this.save(state);
		return state;
	}

	// ===== Private Methods =====

	private save(state: FlowState): void {
		const key = STORAGE_KEY_PREFIX + state.flowId;
		try {
			// Strip originalError before serializing to avoid circular refs and large stacks
			const serializable = { ...state };
			if (serializable.lastError) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { originalError, ...rest } = serializable.lastError;
				serializable.lastError = rest as typeof serializable.lastError;
			}
			sessionStorage.setItem(key, JSON.stringify(serializable));
		} catch (e) {
			logger.error('Failed to save flow state:', e);
		}
	}

	/**
	 * Determine the safe checkpoint to retry from
	 */
	private getRetryCheckpoint(state: FlowState): FlowCheckpoint {
		// For most checkpoints, we can retry from the current position
		// But some require rolling back to a safe point

		// If we were waiting for user action, stay there
		const userActionCheckpoints: FlowCheckpoint[] = [
			'awaiting_consent',
			'awaiting_selection',
		];
		if (userActionCheckpoints.includes(state.checkpoint)) {
			return state.checkpoint;
		}

		// If proof submission failed, we can retry from consent
		if (state.checkpoint === 'proof_submitted' || state.checkpoint === 'awaiting_proof') {
			return state.protocol === 'oid4vci' ? 'consent_given' : 'selection_made';
		}

		// If presentation submission failed, retry from selection
		if (state.checkpoint === 'presentation_submitted') {
			return 'selection_made';
		}

		// Default: try from current checkpoint
		return state.checkpoint;
	}
}

/**
 * Singleton instance for default usage
 */
let defaultManager: FlowStateManager | null = null;

export function getFlowStateManager(options?: FlowRecoveryOptions): FlowStateManager {
	if (!defaultManager) {
		defaultManager = new FlowStateManager(options);
	}
	return defaultManager;
}

/**
 * Reset the singleton (for testing)
 */
export function resetFlowStateManager(): void {
	defaultManager?.clearAll();
	defaultManager = null;
}
