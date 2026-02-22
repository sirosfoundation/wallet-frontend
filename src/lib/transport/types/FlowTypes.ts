/**
 * Common flow types for transport abstraction
 */

/**
 * Transport type enumeration
 */
export type TransportType = 'http' | 'websocket' | 'direct';

/**
 * Generic flow request that can be sent to any transport
 */
export interface FlowRequest {
  /** The type of flow being requested */
  type: 'oid4vci' | 'oid4vp' | 'vctm' | 'general';
  /** The action to perform */
  action: string;
  /** The payload for the request */
  payload: unknown;
}

/**
 * Generic flow response from any transport
 */
export interface FlowResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (if success) */
  data?: T;
  /** Error information (if failure) */
  error?: FlowError;
}

/**
 * Flow error information
 */
export interface FlowError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Optional additional details */
  details?: unknown;
}

/**
 * Progress event emitted during flow execution
 */
export interface FlowProgressEvent {
  /** Unique identifier for the flow */
  flowId: string;
  /** Current stage of the flow */
  stage: string;
  /** Optional progress percentage (0-100) */
  progress?: number;
  /** Optional human-readable message */
  message?: string;
  /** Optional payload data from the server */
  payload?: unknown;
}

/**
 * Transport connection state
 */
export interface TransportConnectionState {
  /** Current transport type in use */
  transportType: TransportType | 'none';
  /** Whether the transport is connected */
  isConnected: boolean;
  /** Available transports based on configuration */
  availableTransports: TransportType[];
}
