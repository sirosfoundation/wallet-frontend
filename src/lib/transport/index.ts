/**
 * Transport Module
 * 
 * This module provides the transport abstraction layer for wallet flows.
 * It supports multiple transport mechanisms for communicating with
 * credential issuers and verifiers.
 */

// Main interface
export { IFlowTransport, NullTransport, nullTransport } from './IFlowTransport';

// Transport implementations
export { HttpProxyTransport } from './HttpProxyTransport';
export { WebSocketTransport } from './WebSocketTransport';
export { DirectTransport } from './DirectTransport';
export type { CorsCheckResult } from './DirectTransport';

// Types
export * from './types';
