/**
 * Transport Module
 *
 * This module provides the transport abstraction layer for wallet flows.
 * It supports multiple transport mechanisms for communicating with
 * credential issuers and verifiers.
 */

// Main interface
export { IFlowTransport, NullTransport, nullTransport } from './types/IFlowTransport';

// Transport implementations
export { HttpProxyTransport } from './HttpProxyTransport';
export { WebSocketTransport } from './WebSocketTransport';
export { DirectTransport } from './DirectTransport';
export type { CorsCheckResult } from './DirectTransport';

// Retry and recovery
export { TransportWithRetry, withRetry } from './decorators/TransportWithRetry';
export type { RetryEvent, RetryTransportOptions, RecoverableFlowResult } from './decorators/TransportWithRetry';
export type { RetryConfig } from './types/FlowRecovery';
export { FlowStateStore, getFlowStateStore, resetFlowStateStore } from './FlowStateStore';
export type { FlowState, FlowProtocol, FlowCheckpoint, FlowRecoveryOptions } from './FlowStateStore';

// Error types and utilities
export * from './types/FlowRecovery';
export * from './utils/flowRecovery';

// Types
export * from './types';
