/**
 * useFlowRecovery Hook
 *
 * React hook for managing flow error recovery and retry state.
 * Provides UI-friendly state and callbacks for error handling.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
	FlowStateStore,
	getFlowStateStore,
	type FlowState,
} from '../lib/transport/FlowStateStore';
import {
	type FlowRecoverableError,
	type RetryConfig,
	DEFAULT_RETRY_CONFIG,
} from '../lib/transport/types/FlowRecovery';
import { logger } from '@/logger';

/**
 * Flow recovery state for UI
 */
export interface FlowRecoveryState {
	/** Whether we're in a recovery state (error occurred, can retry) */
	isRecovering: boolean;
	/** Current retry attempt (0 if not retrying) */
	retryAttempt: number;
	/** Maximum retries allowed */
	maxRetries: number;
	/** Time until next auto-retry (ms), or null if not auto-retrying */
	nextRetryIn: number | null;
	/** Whether manual retry is available */
	canRetry: boolean;
	/** The current error (if any) */
	error: FlowRecoverableError | null;
	/** The flow state being recovered */
	flowState: FlowState | null;
	/** Whether retry is in progress */
	isRetrying: boolean;
}

/**
 * Hook options
 */
export interface UseFlowRecoveryOptions {
	/** Custom retry configuration */
	retryConfig?: Partial<RetryConfig>;
	/** Custom flow state store */
	stateManager?: FlowStateStore;
	/** Callback when flow recovery succeeds */
	onRecovered?: (flowId: string) => void;
	/** Callback when flow permanently fails */
	onFailed?: (flowId: string, error: FlowRecoverableError) => void;
}

/**
 * Hook return value
 */
export interface UseFlowRecoveryReturn {
	/** Current recovery state */
	state: FlowRecoveryState;
	/** Trigger manual retry */
	retry: () => Promise<void>;
	/** Cancel recovery and start over */
	cancel: () => void;
	/** Clear all recovery state */
	clear: () => void;
	/** Set an error for a flow (called by flow hooks) */
	setError: (flowId: string, error: FlowRecoverableError) => void;
	/** Mark recovery complete (called by flow hooks) */
	markRecovered: (flowId: string) => void;
	/** Get all resumable flows */
	getResumableFlows: () => FlowState[];
	/** Check if a specific flow can be retried */
	canRetryFlow: (flowId: string) => boolean;
}

const initialState: FlowRecoveryState = {
	isRecovering: false,
	retryAttempt: 0,
	maxRetries: DEFAULT_RETRY_CONFIG.maxRetries,
	nextRetryIn: null,
	canRetry: false,
	error: null,
	flowState: null,
	isRetrying: false,
};

/**
 * Hook for managing flow error recovery
 */
export function useFlowRecovery(
	retryOperation?: () => Promise<void>,
	options: UseFlowRecoveryOptions = {}
): UseFlowRecoveryReturn {
	const [state, setState] = useState<FlowRecoveryState>({
		...initialState,
		maxRetries: options.retryConfig?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
	});

	const stateManagerRef = useRef<FlowStateStore>(
		options.stateManager ?? getFlowStateStore()
	);
	const retryConfigRef = useRef<RetryConfig>({
		...DEFAULT_RETRY_CONFIG,
		...options.retryConfig,
	});
	const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const retryOperationRef = useRef(retryOperation);

	// Update operation ref when it changes
	useEffect(() => {
		retryOperationRef.current = retryOperation;
	}, [retryOperation]);

	// Cleanup countdown on unmount
	useEffect(() => {
		return () => {
			if (countdownRef.current) {
				clearInterval(countdownRef.current);
			}
		};
	}, []);

	/**
	 * Set error and enter recovery state
	 */
	const setError = useCallback((flowId: string, error: FlowRecoverableError) => {
		const stateManager = stateManagerRef.current;
		const flowState = stateManager.recordError(flowId, error);

		if (!flowState) {
			logger.warn('setError: flow not found', flowId);
			return;
		}

		const canRetry = error.recoverable && flowState.retryCount < retryConfigRef.current.maxRetries;

		setState(prev => ({
			...prev,
			isRecovering: true,
			retryAttempt: flowState.retryCount,
			canRetry,
			error,
			flowState,
			nextRetryIn: null,
			isRetrying: false,
		}));

		// Call onFailed when no more retries are possible (either non-recoverable or retries exhausted)
		if (!canRetry) {
			options.onFailed?.(flowId, error);
		}
	}, [options]);

	/**
	 * Mark a flow as recovered
	 */
	const markRecovered = useCallback((flowId: string) => {
		const stateManager = stateManagerRef.current;
		stateManager.complete(flowId);

		setState({
			...initialState,
			maxRetries: retryConfigRef.current.maxRetries,
		});

		options.onRecovered?.(flowId);
	}, [options]);

	/**
	 * Trigger a manual retry
	 */
	const retry = useCallback(async () => {
		if (!state.flowState || !state.canRetry || !retryOperationRef.current) {
			logger.warn('Cannot retry: no flow state, cannot retry, or no operation');
			return;
		}

		const stateManager = stateManagerRef.current;
		const flowId = state.flowState.flowId;

		// Prepare for retry
		const preparedState = stateManager.prepareRetry(flowId);
		if (!preparedState) {
			logger.warn('Failed to prepare retry');
			return;
		}

		setState(prev => ({
			...prev,
			isRetrying: true,
			nextRetryIn: null,
		}));

		try {
			await retryOperationRef.current();
			// If successful, the flow hook should call markRecovered
		} catch (error) {
			// Error will be handled by setError from the flow hook
			logger.debug('Retry failed:', error);
		}
	}, [state.flowState, state.canRetry]);

	/**
	 * Cancel recovery and abandon the flow
	 */
	const cancel = useCallback(() => {
		if (countdownRef.current) {
			clearInterval(countdownRef.current);
			countdownRef.current = null;
		}

		if (state.flowState) {
			stateManagerRef.current.cancel(state.flowState.flowId);
		}

		setState({
			...initialState,
			maxRetries: retryConfigRef.current.maxRetries,
		});
	}, [state.flowState]);

	/**
	 * Clear all recovery state
	 */
	const clear = useCallback(() => {
		if (countdownRef.current) {
			clearInterval(countdownRef.current);
			countdownRef.current = null;
		}

		stateManagerRef.current.clearAll();

		setState({
			...initialState,
			maxRetries: retryConfigRef.current.maxRetries,
		});
	}, []);

	/**
	 * Get all resumable flows from storage
	 */
	const getResumableFlows = useCallback(() => {
		return stateManagerRef.current.getResumableFlows();
	}, []);

	/**
	 * Check if a specific flow can be retried
	 */
	const canRetryFlow = useCallback((flowId: string) => {
		return stateManagerRef.current.canRetry(flowId, retryConfigRef.current.maxRetries);
	}, []);

	return {
		state,
		retry,
		cancel,
		clear,
		setError,
		markRecovered,
		getResumableFlows,
		canRetryFlow,
	};
}

/**
 * Simple hook for retry countdown display
 */
export function useRetryCountdown(
	nextRetryIn: number | null,
	onComplete?: () => void
): number {
	const [remaining, setRemaining] = useState(nextRetryIn ?? 0);

	useEffect(() => {
		if (nextRetryIn === null || nextRetryIn <= 0) {
			setRemaining(0);
			return;
		}

		setRemaining(nextRetryIn);

		const interval = setInterval(() => {
			setRemaining(prev => {
				const next = prev - 1000;
				if (next <= 0) {
					clearInterval(interval);
					onComplete?.();
					return 0;
				}
				return next;
			});
		}, 1000);

		return () => clearInterval(interval);
	}, [nextRetryIn, onComplete]);

	return Math.max(0, Math.ceil(remaining / 1000));
}
