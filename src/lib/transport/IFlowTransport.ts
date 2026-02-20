/**
 * Flow Transport Interface
 * 
 * This interface defines the contract for transport implementations
 * that handle OID4VCI and OID4VP flows. The wallet frontend uses
 * this abstraction to support multiple transport mechanisms:
 * 
 * - HTTP Proxy: Backend proxies all requests (current, with OHTTP)
 * - WebSocket: Backend orchestrates flows via persistent connection
 * - Direct: Browser makes direct CORS requests (future, when ecosystem ready)
 */

import type { FlowRequest, FlowResponse, FlowProgressEvent } from './types/FlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult } from './types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult } from './types/OID4VPTypes';

/**
 * Transport interface for credential flows
 * 
 * Implementations handle the communication between the wallet frontend
 * and credential issuers/verifiers through various mechanisms.
 */
export interface IFlowTransport {
  // ===== Connection Lifecycle =====
  
  /**
   * Establish the transport connection
   * For HTTP, this is a no-op. For WebSocket, opens the connection.
   */
  connect(): Promise<void>;
  
  /**
   * Close the transport connection
   */
  disconnect(): Promise<void>;
  
  /**
   * Check if the transport is currently connected
   */
  isConnected(): boolean;
  
  // ===== OID4VCI (Credential Issuance) =====
  
  /**
   * Start or continue an OID4VCI credential issuance flow
   * 
   * This is a multi-step flow:
   * 1. Call with credentialOfferUri to start and get metadata
   * 2. Call with holderBinding + credentialConfigurationId after consent
   * 3. Call with authorizationCode if authorization was required
   * 
   * @param params - Flow parameters for the current step
   * @returns Flow result with metadata, authorization info, or credential
   */
  startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult>;
  
  // ===== OID4VP (Verifiable Presentation) =====
  
  /**
   * Start or continue an OID4VP verifiable presentation flow
   * 
   * This is a multi-step flow:
   * 1. Call with authorizationRequestUri to start and get presentation requirements
   * 2. Call with selectedCredentials after user selects credentials
   * 
   * @param params - Flow parameters for the current step
   * @returns Flow result with presentation definition or submission result
   */
  startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult>;
  
  // ===== Generic Request =====
  
  /**
   * Send a generic request through the transport
   * Useful for backwards compatibility and edge cases
   * 
   * @param flowRequest - The request to send
   * @returns Generic flow response
   */
  request<T>(flowRequest: FlowRequest): Promise<FlowResponse<T>>;
  
  // ===== Event Subscriptions =====
  
  /**
   * Subscribe to progress events during flow execution
   * Returns an unsubscribe function
   */
  onProgress(callback: (event: FlowProgressEvent) => void): () => void;
  
  /**
   * Subscribe to error events
   * Returns an unsubscribe function
   */
  onError(callback: (error: Error) => void): () => void;
}

/**
 * Null transport implementation for when no transport is available
 */
export class NullTransport implements IFlowTransport {
  async connect(): Promise<void> {
    throw new Error('No transport configured');
  }
  
  async disconnect(): Promise<void> {
    // No-op
  }
  
  isConnected(): boolean {
    return false;
  }
  
  async startOID4VCIFlow(): Promise<OID4VCIFlowResult> {
    throw new Error('No transport configured');
  }
  
  async startOID4VPFlow(): Promise<OID4VPFlowResult> {
    throw new Error('No transport configured');
  }
  
  async request<T>(): Promise<FlowResponse<T>> {
    throw new Error('No transport configured');
  }
  
  onProgress(): () => void {
    return () => {};
  }
  
  onError(): () => void {
    return () => {};
  }
}

/** Singleton null transport instance */
export const nullTransport = new NullTransport();
