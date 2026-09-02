/**
 * Transport Module
 *
 * This module provides the transport abstraction layer for wallet flows.
 * It supports multiple transport mechanisms for communicating with
 * credential issuers and verifiers.
 */

// Main interface
export { type IOIDFlowTransport, NullOIDFlowTransport, nullOIDFlowTransport } from './types/IOIDFlowTransport';

// Transport implementations
export { OIDFlowHttpProxyTransport } from './transports/OIDFlowHttpProxyTransport';
export { OIDFlowWebSocketTransport } from './transports/OIDFlowWebSocketTransport';
export { OIDFlowDirectTransport } from './transports/OIDFlowDirectTransport';
export type { CorsCheckResult } from './transports/OIDFlowDirectTransport';

// Retry and recovery
export { withRetry } from './decorators/OIDFlowTransportWithRetry';
export { OIDFlowTransportWithRetry, type OIDFlowRetryEvent, type OIDFlowTransportWithRetryOptions, type OIDFlowRecoverableResult } from './decorators/OIDFlowTransportWithRetry';
export type { OIDFlowRetryConfig } from './types/OIDFlowRecovery';
export { OIDFlowStateStore, getOIDFlowStateStore, resetOIDFlowStateStore } from './OIDFlowStateStore';
export type { OIDFlowState, OIDFlowProtocol, OIDFlowCheckpoint, OIDFlowRecoveryOptions } from './OIDFlowStateStore';

// Error types and utilities
export * from './types/OIDFlowRecovery';
export * from './utils/oidFlowRecovery';

// Types
export * from './types';
