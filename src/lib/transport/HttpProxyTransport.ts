/**
 * HTTP Proxy Transport
 * 
 * This transport implementation wraps the existing HTTP proxy mechanism
 * for making external requests through the wallet backend. It's used
 * as a fallback when WebSocket is not available or not preferred.
 * 
 * For OID4VCI/OID4VP flows, this transport delegates to the existing
 * hook-based implementations rather than implementing the flows directly.
 * The flow-specific methods throw errors indicating that the hooks should
 * be used instead - this is by design for the hybrid approach where
 * HTTP transport preserves the existing behavior.
 */

import type { IFlowTransport } from './IFlowTransport';
import type { IHttpProxy } from '../interfaces/IHttpProxy';
import type { 
  FlowRequest, 
  FlowResponse, 
  FlowProgressEvent 
} from './types/FlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult } from './types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult } from './types/OID4VPTypes';

/**
 * HTTP Proxy Transport implementation
 * 
 * Wraps the existing IHttpProxy interface to provide transport functionality.
 * For complex flows (OID4VCI/OID4VP), the existing React hooks are used
 * via the hybrid flow hooks, not this transport directly.
 */
export class HttpProxyTransport implements IFlowTransport {
  private httpProxy: IHttpProxy;
  private progressCallbacks = new Set<(event: FlowProgressEvent) => void>();
  private errorCallbacks = new Set<(error: Error) => void>();
  
  constructor(httpProxy: IHttpProxy) {
    this.httpProxy = httpProxy;
  }
  
  // ===== Connection Lifecycle =====
  
  async connect(): Promise<void> {
    // HTTP is stateless - always "connected"
  }
  
  async disconnect(): Promise<void> {
    // No persistent connection to close
  }
  
  isConnected(): boolean {
    // HTTP transport is always ready
    return true;
  }
  
  // ===== OID4VCI Flow =====
  
  async startOID4VCIFlow(_params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
    // HTTP transport delegates to existing hooks for full flow implementation
    // This throws to indicate that the hybrid hook should use the existing
    // OpenID4VCI hook directly instead of calling this method
    throw new Error(
      'HTTP transport does not implement OID4VCI flow directly. ' +
      'Use the existing useOpenID4VCI hook via the hybrid flow hook.'
    );
  }
  
  // ===== OID4VP Flow =====
  
  async startOID4VPFlow(_params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
    // HTTP transport delegates to existing hooks for full flow implementation
    throw new Error(
      'HTTP transport does not implement OID4VP flow directly. ' +
      'Use the existing useOpenID4VP hook via the hybrid flow hook.'
    );
  }
  
  // ===== Generic Request =====
  
  async request<T>(flowRequest: FlowRequest): Promise<FlowResponse<T>> {
    if (flowRequest.type !== 'general') {
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_FLOW_TYPE',
          message: `HTTP transport only supports 'general' flow type for raw requests. Got: ${flowRequest.type}`,
        },
      };
    }
    
    const payload = flowRequest.payload as {
      method: 'GET' | 'POST';
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    
    try {
      let response;
      
      if (payload.method === 'GET') {
        response = await this.httpProxy.get(payload.url, payload.headers);
      } else {
        response = await this.httpProxy.post(payload.url, payload.body, payload.headers);
      }
      
      return {
        success: response.status >= 200 && response.status < 300,
        data: response.data as T,
        error: response.status >= 400 ? {
          code: `HTTP_${response.status}`,
          message: `HTTP request failed with status ${response.status}`,
        } : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      this.emitError(new Error(message));
      
      return {
        success: false,
        error: {
          code: 'HTTP_ERROR',
          message,
        },
      };
    }
  }
  
  // ===== Event Subscriptions =====
  
  onProgress(callback: (event: FlowProgressEvent) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }
  
  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }
  
  // ===== Internal Helpers =====
  
  private emitError(error: Error): void {
    Array.from(this.errorCallbacks).forEach(callback => {
      try {
        callback(error);
      } catch (e) {
        console.error('Error in error callback:', e);
      }
    });
  }
  
  /**
   * Get the underlying HTTP proxy instance
   * Useful for code that needs direct access to the proxy
   */
  getHttpProxy(): IHttpProxy {
    return this.httpProxy;
  }
}
