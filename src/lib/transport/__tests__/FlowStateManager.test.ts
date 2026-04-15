import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	FlowStateStore,
	getFlowStateStore,
	resetFlowStateStore,
	type FlowState,
} from '../FlowStateStore';
import { createFlowError } from '../flowRecoveryUtils';
import { FlowErrorCodes } from '../types/FlowRecovery';

// Mock sessionStorage
const mockStorage: Record<string, string> = {};
const mockSessionStorage = {
	getItem: vi.fn((key: string) => mockStorage[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
	removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
	get length() { return Object.keys(mockStorage).length; },
	key: vi.fn((index: number) => Object.keys(mockStorage)[index] ?? null),
	clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
};

describe('FlowStateStore', () => {
	let manager: FlowStateStore;

	beforeEach(() => {
		// Clear mock storage
		Object.keys(mockStorage).forEach(k => delete mockStorage[k]);

		// Mock sessionStorage
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: mockSessionStorage,
			writable: true,
		});

		manager = new FlowStateStore();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('create', () => {
		it('should create a new flow state', () => {
			const state = manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');

			expect(state.flowId).toBe('flow-1');
			expect(state.protocol).toBe('oid4vci');
			expect(state.entryUri).toBe('https://issuer.example/offer');
			expect(state.checkpoint).toBe('initialized');
			expect(state.retryCount).toBe(0);
			expect(state.startedAt).toBeDefined();
			expect(state.updatedAt).toBeDefined();
		});

		it('should persist to sessionStorage', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');

			expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
				'wallet_flow_state_flow-1',
				expect.any(String)
			);
		});

		it('should include initial data if provided', () => {
			const state = manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer', {
				issuerMetadata: { name: 'Test Issuer' },
			});

			expect(state.data.issuerMetadata).toEqual({ name: 'Test Issuer' });
		});
	});

	describe('get', () => {
		it('should retrieve a flow state', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const state = manager.get('flow-1');

			expect(state).not.toBeNull();
			expect(state?.flowId).toBe('flow-1');
		});

		it('should return null for non-existent flow', () => {
			const state = manager.get('non-existent');
			expect(state).toBeNull();
		});

		it('should return null and delete expired flows', () => {
			// Create a flow with old timestamp
			const oldState: FlowState = {
				flowId: 'old-flow',
				protocol: 'oid4vci',
				checkpoint: 'initialized',
				entryUri: 'https://issuer.example/offer',
				startedAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago
				updatedAt: Date.now() - 10 * 60 * 1000,
				retryCount: 0,
				data: {},
			};
			mockStorage['wallet_flow_state_old-flow'] = JSON.stringify(oldState);

			const state = manager.get('old-flow');

			expect(state).toBeNull();
			expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('wallet_flow_state_old-flow');
		});
	});

	describe('updateCheckpoint', () => {
		it('should update the checkpoint', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const state = manager.updateCheckpoint('flow-1', 'metadata_fetched');

			expect(state?.checkpoint).toBe('metadata_fetched');
		});

		it('should merge additional data', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const state = manager.updateCheckpoint('flow-1', 'metadata_fetched', {
				issuerName: 'Test Issuer',
			});

			expect(state?.data.issuerName).toBe('Test Issuer');
		});

		it('should return null for non-existent flow', () => {
			const state = manager.updateCheckpoint('non-existent', 'metadata_fetched');
			expect(state).toBeNull();
		});
	});

	describe('recordError', () => {
		it('should record a recoverable error and increment retry count', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');

			const state = manager.recordError('flow-1', error);

			expect(state?.lastError).toEqual(error);
			expect(state?.retryCount).toBe(1);
		});

		it('should set checkpoint to failed for non-recoverable errors', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const error = createFlowError(FlowErrorCodes.INVALID_CREDENTIAL, 'Invalid');

			const state = manager.recordError('flow-1', error);

			expect(state?.checkpoint).toBe('failed');
		});
	});

	describe('canRetry', () => {
		it('should return true when under retry limit with recoverable error', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');
			manager.recordError('flow-1', error);

			expect(manager.canRetry('flow-1', 3)).toBe(true);
		});

		it('should return false when at retry limit', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');

			// Simulate 3 retries
			manager.recordError('flow-1', error);
			manager.recordError('flow-1', error);
			manager.recordError('flow-1', error);

			expect(manager.canRetry('flow-1', 3)).toBe(false);
		});

		it('should return false for non-recoverable errors', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			const error = createFlowError(FlowErrorCodes.INVALID_CREDENTIAL, 'Invalid');
			manager.recordError('flow-1', error);

			expect(manager.canRetry('flow-1', 3)).toBe(false);
		});

		it('should return false for non-existent flow', () => {
			expect(manager.canRetry('non-existent', 3)).toBe(false);
		});
	});

	describe('prepareRetry', () => {
		it('should clear error and prepare for retry', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.updateCheckpoint('flow-1', 'consent_given');
			const error = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');
			manager.recordError('flow-1', error);

			const state = manager.prepareRetry('flow-1');

			expect(state?.lastError).toBeUndefined();
			expect(state?.checkpoint).toBe('consent_given');
		});

		it('should rollback to safe checkpoint for proof submission errors', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.updateCheckpoint('flow-1', 'proof_submitted');
			const error = createFlowError(FlowErrorCodes.SIGN_TIMEOUT, 'Timeout');
			manager.recordError('flow-1', error);

			const state = manager.prepareRetry('flow-1');

			// Should rollback to consent_given for OID4VCI
			expect(state?.checkpoint).toBe('consent_given');
		});
	});

	describe('complete', () => {
		it('should mark flow as completed', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.complete('flow-1');

			const state = manager.get('flow-1');
			expect(state?.checkpoint).toBe('completed');
		});
	});

	describe('cancel', () => {
		it('should delete the flow state', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.cancel('flow-1');

			expect(manager.get('flow-1')).toBeNull();
		});
	});

	describe('getActiveFlows', () => {
		it('should return all non-terminal flows', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.create('flow-2', 'oid4vp', 'https://verifier.example/request');
			manager.create('flow-3', 'oid4vci', 'https://issuer.example/offer2');
			manager.complete('flow-3');

			const active = manager.getActiveFlows();

			expect(active).toHaveLength(2);
			expect(active.map(f => f.flowId)).toContain('flow-1');
			expect(active.map(f => f.flowId)).toContain('flow-2');
		});
	});

	describe('getResumableFlows', () => {
		it('should return flows with recoverable errors', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.create('flow-2', 'oid4vp', 'https://verifier.example/request');

			const recoverableError = createFlowError(FlowErrorCodes.NETWORK_TIMEOUT, 'Timeout');
			manager.recordError('flow-1', recoverableError);

			const fatalError = createFlowError(FlowErrorCodes.INVALID_CREDENTIAL, 'Invalid');
			manager.recordError('flow-2', fatalError);

			const resumable = manager.getResumableFlows();

			expect(resumable).toHaveLength(1);
			expect(resumable[0].flowId).toBe('flow-1');
		});
	});

	describe('singleton', () => {
		it('should return the same instance', () => {
			const instance1 = getFlowStateStore();
			const instance2 = getFlowStateStore();

			expect(instance1).toBe(instance2);
		});

		it('should reset the singleton', () => {
			const instance1 = getFlowStateStore();
			resetFlowStateStore();
			const instance2 = getFlowStateStore();

			expect(instance1).not.toBe(instance2);
		});
	});

	describe('clearAll', () => {
		it('should clear all flow states', () => {
			manager.create('flow-1', 'oid4vci', 'https://issuer.example/offer');
			manager.create('flow-2', 'oid4vp', 'https://verifier.example/request');

			manager.clearAll();

			expect(manager.getActiveFlows()).toHaveLength(0);
		});
	});
});
