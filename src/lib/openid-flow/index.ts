/**
 * Transport Module
 *
 * This module provides the transport abstraction layer for wallet flows.
 * It supports multiple transport mechanisms for communicating with
 * credential issuers and verifiers.
 */

// Retry and recovery
export {
	type OIDFlowRecoverableResult,
	type OIDFlowRetryEvent,
	OIDFlowTransportWithRetry,
	type OIDFlowTransportWithRetryOptions,
	withRetry,
} from './decorators/OIDFlowTransportWithRetry';
export type {
	OIDFlowCheckpoint,
	OIDFlowProtocol,
	OIDFlowRecoveryOptions,
	OIDFlowState,
} from './OIDFlowStateStore';
export {
	getOIDFlowStateStore,
	OIDFlowStateStore,
	resetOIDFlowStateStore,
} from './OIDFlowStateStore';
export type { CorsCheckResult } from './transports/OIDFlowDirectTransport';
export { OIDFlowDirectTransport } from './transports/OIDFlowDirectTransport';
// Transport implementations
export { OIDFlowHttpProxyTransport } from './transports/OIDFlowHttpProxyTransport';
export { OIDFlowWebSocketTransport } from './transports/OIDFlowWebSocketTransport';
// Types
export * from './types';
// Main interface
export {
	type IOIDFlowTransport,
	NullOIDFlowTransport,
	nullOIDFlowTransport,
} from './types/IOIDFlowTransport';
export type { OIDFlowRetryConfig } from './types/OIDFlowRecovery';
// Error types and utilities
export * from './types/OIDFlowRecovery';
export * from './utils/oidFlowRecovery';
