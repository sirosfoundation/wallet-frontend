/**
 * WebSocket Transport
 * 
 * This transport implementation connects to the wallet backend via WebSocket
 * for orchestrating OID4VCI and OID4VP flows. The backend handles all external
 * HTTP requests and sends progress updates back through the WebSocket.
 * 
 * Benefits over HTTP proxy:
 * - Lower latency (persistent connection)
 * - Real-time progress updates
 * - Server can orchestrate multi-step flows
 * - Better error handling with flow state
 */

import type { IFlowTransport } from './IFlowTransport';
import type { 
  FlowRequest, 
  FlowResponse, 
  FlowProgressEvent 
} from './types/FlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult } from './types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult } from './types/OID4VPTypes';

/**
 * Pending request waiting for a response
 */
interface PendingRequest<T = unknown> {
  resolve: (response: T) => void;
  reject: (error: Error) => void;
  flowId: string;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket message from server
 */
interface ServerMessage {
  flowId: string;
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket Transport implementation
 */
export class WebSocketTransport implements IFlowTransport {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private authToken: string;
  
  private pending = new Map<string, PendingRequest>();
  private progressCallbacks = new Set<(event: FlowProgressEvent) => void>();
  private errorCallbacks = new Set<(error: Error) => void>();
  
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private requestTimeout = 60000; // 60 seconds
  
  private connectionPromise: Promise<void> | null = null;
  
  constructor(wsUrl: string, authToken: string) {
    this.wsUrl = wsUrl;
    this.authToken = authToken;
  }
  
  // ===== Connection Lifecycle =====
  
  async connect(): Promise<void> {
    // If already connecting, return the existing promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    // If already connected, return immediately
    if (this.isConnected()) {
      return Promise.resolve();
    }
    
    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        // Add auth token as query parameter
        const url = `${this.wsUrl}?token=${encodeURIComponent(this.authToken)}`;
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connectionPromise = null;
          resolve();
        };
        
        this.ws.onerror = (event) => {
          console.error('WebSocket error:', event);
          this.connectionPromise = null;
          reject(new Error('WebSocket connection failed'));
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as ServerMessage;
            this.handleMessage(message);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
          }
        };
        
        this.ws.onclose = (event) => {
          this.handleDisconnect(event);
        };
      } catch (error) {
        this.connectionPromise = null;
        reject(error);
      }
    });
    
    return this.connectionPromise;
  }
  
  async disconnect(): Promise<void> {
    if (this.ws) {
      // Cancel all pending requests
      Array.from(this.pending.entries()).forEach(([id, pending]) => {
        clearTimeout(pending.timeout);
        pending.reject(new Error('WebSocket disconnected'));
      });
      this.pending.clear();
      
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connectionPromise = null;
  }
  
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  // ===== OID4VCI Flow =====
  
  async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
    // Determine which phase of the flow we're in based on params
    
    if (params.credentialOfferUri || params.credentialOffer) {
      // Phase 1: Start flow with credential offer
      const response = await this.send({
        type: 'flow.start',
        flow: 'oid4vci',
        credentialOfferUri: params.credentialOfferUri,
        credentialOffer: params.credentialOffer,
      });
      
      return this.mapOID4VCIResponse(response);
    }
    
    if (params.holderBinding && params.credentialConfigurationId) {
      // Phase 2: User consented, provide holder binding
      const response = await this.send({
        type: 'flow.continue',
        flow: 'oid4vci',
        action: 'consent',
        holderPublicKey: params.holderBinding.publicKeyJwk,
        holderBindingMethod: params.holderBinding.method,
        credentialConfigurationId: params.credentialConfigurationId,
      });
      
      return this.mapOID4VCIResponse(response);
    }
    
    if (params.authorizationCode) {
      // Phase 3: Authorization code received
      const response = await this.send({
        type: 'flow.continue',
        flow: 'oid4vci',
        action: 'token_exchange',
        authorizationCode: params.authorizationCode,
        codeVerifier: params.codeVerifier,
      });
      
      return this.mapOID4VCIResponse(response);
    }
    
    if (params.preAuthorizedCode) {
      // Pre-authorized flow
      const response = await this.send({
        type: 'flow.continue',
        flow: 'oid4vci',
        action: 'pre_authorized',
        preAuthorizedCode: params.preAuthorizedCode,
        txCodeInput: params.txCodeInput,
      });
      
      return this.mapOID4VCIResponse(response);
    }
    
    throw new Error('Invalid OID4VCI flow params: no valid entry point or continuation');
  }
  
  private mapOID4VCIResponse(response: ServerMessage): OID4VCIFlowResult {
    if (response.type === 'error') {
      return {
        success: false,
        error: {
          code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
          message: (response.error as { message?: string })?.message ?? 'Unknown error',
        },
      };
    }
    
    // Map server response to OID4VCIFlowResult
    const result: OID4VCIFlowResult = {
      success: true,
    };
    
    // Metadata phase
    if (response.issuerMetadata) {
      result.issuerMetadata = response.issuerMetadata as OID4VCIFlowResult['issuerMetadata'];
    }
    if (response.credentialConfigurations) {
      result.credentialConfigurations = response.credentialConfigurations as OID4VCIFlowResult['credentialConfigurations'];
    }
    if (response.selectedCredentialConfigurationId) {
      result.selectedCredentialConfigurationId = response.selectedCredentialConfigurationId as string;
    }
    
    // Authorization
    if (response.authorizationRequired !== undefined) {
      result.authorizationRequired = response.authorizationRequired as boolean;
    }
    if (response.authorizationUrl) {
      result.authorizationUrl = response.authorizationUrl as string;
    }
    if (response.issuerState) {
      result.issuerState = response.issuerState as string;
    }
    
    // Pre-auth
    if (response.preAuthorizedCode) {
      result.preAuthorizedCode = response.preAuthorizedCode as string;
    }
    if (response.txCode) {
      result.txCode = response.txCode as OID4VCIFlowResult['txCode'];
    }
    
    // Credential
    if (response.credential) {
      result.credential = response.credential as string;
    }
    if (response.format) {
      result.format = response.format as string;
    }
    
    // Deferred
    if (response.transactionId) {
      result.transactionId = response.transactionId as string;
    }
    
    return result;
  }
  
  // ===== OID4VP Flow =====
  
  async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
    if (params.authorizationRequestUri && !params.selectedCredentials) {
      // Phase 1: Start flow with authorization request
      const response = await this.send({
        type: 'flow.start',
        flow: 'oid4vp',
        authorizationRequestUri: params.authorizationRequestUri,
      });
      
      return this.mapOID4VPResponse(response);
    }
    
    if (params.selectedCredentials) {
      // Phase 2: User selected credentials, submit response
      const response = await this.send({
        type: 'flow.continue',
        flow: 'oid4vp',
        action: 'submit',
        selectedCredentials: params.selectedCredentials,
      });
      
      return this.mapOID4VPResponse(response);
    }
    
    throw new Error('Invalid OID4VP flow params: no valid entry point or continuation');
  }
  
  private mapOID4VPResponse(response: ServerMessage): OID4VPFlowResult {
    if (response.type === 'error') {
      return {
        success: false,
        error: {
          code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
          message: (response.error as { message?: string })?.message ?? 'Unknown error',
        },
      };
    }
    
    const result: OID4VPFlowResult = {
      success: true,
    };
    
    // Presentation definition phase
    if (response.presentationDefinition) {
      result.presentationDefinition = response.presentationDefinition as OID4VPFlowResult['presentationDefinition'];
    }
    if (response.conformantCredentials) {
      // Convert from object to Map if needed
      const creds = response.conformantCredentials;
      if (creds instanceof Map) {
        result.conformantCredentials = creds;
      } else if (typeof creds === 'object') {
        result.conformantCredentials = new Map(Object.entries(creds as Record<string, unknown[]>));
      }
    }
    if (response.verifierInfo) {
      result.verifierInfo = response.verifierInfo as OID4VPFlowResult['verifierInfo'];
    }
    if (response.transactionData) {
      result.transactionData = response.transactionData as OID4VPFlowResult['transactionData'];
    }
    
    // Submission result
    if (response.redirectUri) {
      result.redirectUri = response.redirectUri as string;
    }
    if (response.responseData) {
      result.responseData = response.responseData;
    }
    
    return result;
  }
  
  // ===== Generic Request =====
  
  async request<T>(flowRequest: FlowRequest): Promise<FlowResponse<T>> {
    try {
      const response = await this.send({
        type: 'generic.request',
        flowType: flowRequest.type,
        action: flowRequest.action,
        payload: flowRequest.payload,
      });
      
      if (response.type === 'error') {
        return {
          success: false,
          error: {
            code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
            message: (response.error as { message?: string })?.message ?? 'Unknown error',
          },
        };
      }
      
      return {
        success: true,
        data: response.data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'WEBSOCKET_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
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
  
  // ===== Internal Methods =====
  
  private handleMessage(message: ServerMessage): void {
    const { flowId, type } = message;
    
    // Handle progress events separately
    if (type === 'progress') {
      this.emitProgress({
        flowId,
        stage: message.stage as string,
        progress: message.progress as number | undefined,
        message: message.message as string | undefined,
      });
      return;
    }
    
    // All other message types resolve a pending request
    const pending = this.pending.get(flowId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(flowId);
      
      if (type === 'error') {
        pending.reject(new Error((message.error as { message?: string })?.message ?? 'Unknown error'));
      } else {
        pending.resolve(message);
      }
    } else {
      console.warn('Received message for unknown flowId:', flowId);
    }
  }
  
  private handleDisconnect(event: CloseEvent): void {
    // Reject all pending requests
    Array.from(this.pending.entries()).forEach(([id, pending]) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket disconnected'));
    });
    this.pending.clear();
    
    // Reset connection state
    this.ws = null;
    this.connectionPromise = null;
    
    // Don't reconnect if it was a clean close
    if (event.code === 1000) {
      return;
    }
    
    // Attempt reconnect with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;
      
      console.log(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      setTimeout(() => {
        this.connect().catch((error) => {
          console.error('WebSocket reconnect failed:', error);
          this.emitError(new Error('WebSocket reconnection failed'));
        });
      }, delay);
    } else {
      this.emitError(new Error('WebSocket connection lost after max reconnect attempts'));
    }
  }
  
  private send(message: Record<string, unknown>): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      const flowId = (message.flowId as string) || crypto.randomUUID();
      const fullMessage = { ...message, flowId };
      
      // Set up timeout
      const timeout = setTimeout(() => {
        if (this.pending.has(flowId)) {
          this.pending.delete(flowId);
          reject(new Error('Request timeout'));
        }
      }, this.requestTimeout);
      
      // Store pending request
      this.pending.set(flowId, { resolve, reject, flowId, timeout });
      
      // Send message
      try {
        this.ws!.send(JSON.stringify(fullMessage));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(flowId);
        reject(error);
      }
    });
  }
  
  private emitProgress(event: FlowProgressEvent): void {
    Array.from(this.progressCallbacks).forEach(callback => {
      try {
        callback(event);
      } catch (e) {
        console.error('Error in progress callback:', e);
      }
    });
  }
  
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
   * Update the auth token (e.g., after token refresh)
   */
  updateAuthToken(token: string): void {
    this.authToken = token;
  }
  
  /**
   * Get the current connection state
   */
  getConnectionState(): {
    connected: boolean;
    reconnectAttempts: number;
    pendingRequests: number;
  } {
    return {
      connected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pending.size,
    };
  }
}
