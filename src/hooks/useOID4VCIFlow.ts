/**
 * Hybrid OID4VCI Flow Hook
 * 
 * This hook provides a unified interface for credential issuance flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 * 
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useState } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import OpenID4VCIContext from '@/context/OpenID4VCIContext';
import type { 
  OID4VCIFlowParams, 
  OID4VCIFlowResult 
} from '@/lib/transport/types/OID4VCITypes';
import type { FlowProgressEvent } from '@/lib/transport/types/FlowTypes';

export interface UseOID4VCIFlowOptions {
  /** Called when flow progress updates */
  onProgress?: (event: FlowProgressEvent) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseOID4VCIFlowReturn {
  /** Start an OID4VCI flow with a credential offer URI */
  handleCredentialOffer: (credentialOfferUri: string) => Promise<OID4VCIFlowResult>;
  
  /** Continue flow with authorization code (after redirect) */
  handleAuthorizationResponse: (authCode: string, codeVerifier?: string) => Promise<OID4VCIFlowResult>;
  
  /** Continue flow with pre-authorized code and optional TX code */
  requestWithPreAuthorization: (
    preAuthorizedCode: string,
    txCodeInput?: string
  ) => Promise<OID4VCIFlowResult>;
  
  /** Current transport type being used */
  transportType: 'http' | 'websocket' | 'direct' | 'none';
  
  /** Whether a flow is currently in progress */
  isLoading: boolean;
  
  /** Last error if any */
  error: Error | null;
  
  /** Clear the last error */
  clearError: () => void;
}

/**
 * Hook for credential issuance flows with transport abstraction
 * 
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VCI implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VCIFlow(options: UseOID4VCIFlowOptions = {}): UseOID4VCIFlowReturn {
  const { onProgress, onError } = options;
  
  const transportContext = useFlowTransportSafe();
  const { openID4VCI } = useContext(OpenID4VCIContext);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const transportType = transportContext?.transportType ?? 'none';
  const transport = transportContext?.transport;
  
  const clearError = useCallback(() => {
    setError(null);
    transportContext?.clearError?.();
  }, [transportContext]);
  
  /**
   * Handle credential offer using the appropriate transport
   */
  const handleCredentialOffer = useCallback(async (
    credentialOfferUri: string
  ): Promise<OID4VCIFlowResult> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // WebSocket transport: delegate to backend
      if (transportType === 'websocket' && transport) {
        // Subscribe to progress events for this flow
        const unsubscribeProgress = onProgress 
          ? transport.onProgress(onProgress) 
          : () => {};
        const unsubscribeError = onError
          ? transport.onError(onError)
          : () => {};
        
        try {
          const result = await transport.startOID4VCIFlow({
            credentialOfferUri,
          });
          return result;
        } finally {
          unsubscribeProgress();
          unsubscribeError();
        }
      }
      
      // HTTP transport: use existing implementation
      if (transportType === 'http' && openID4VCI) {
        try {
          const result = await openID4VCI.handleCredentialOffer(credentialOfferUri);
          
          // Convert to OID4VCIFlowResult format
          return {
            success: true,
            selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
            preAuthorizedCode: result.preAuthorizedCode,
            issuerState: result.issuer_state,
            txCode: result.txCode,
          };
        } catch (err) {
          throw err;
        }
      }
      
      // No transport available
      throw new Error('No transport available for credential issuance');
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      return {
        success: false,
        error: {
          code: 'FLOW_ERROR',
          message: error.message,
        },
      };
    } finally {
      setIsLoading(false);
    }
  }, [transportType, transport, openID4VCI, onProgress, onError]);
  
  /**
   * Handle authorization response (after OAuth redirect)
   */
  const handleAuthorizationResponse = useCallback(async (
    authCode: string,
    codeVerifier?: string
  ): Promise<OID4VCIFlowResult> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // WebSocket transport: continue flow on backend
      if (transportType === 'websocket' && transport) {
        const unsubscribeProgress = onProgress 
          ? transport.onProgress(onProgress) 
          : () => {};
        
        try {
          const result = await transport.startOID4VCIFlow({
            authorizationCode: authCode,
            codeVerifier,
          });
          return result;
        } finally {
          unsubscribeProgress();
        }
      }
      
      // HTTP transport: use existing implementation
      if (transportType === 'http' && openID4VCI) {
        // Note: handleAuthorizationResponse in the current implementation
        // takes the full URL with the code as a parameter
        await openID4VCI.handleAuthorizationResponse(authCode);
        
        return {
          success: true,
        };
      }
      
      throw new Error('No transport available');
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      return {
        success: false,
        error: {
          code: 'AUTH_RESPONSE_ERROR',
          message: error.message,
        },
      };
    } finally {
      setIsLoading(false);
    }
  }, [transportType, transport, openID4VCI, onProgress, onError]);
  
  /**
   * Request credentials with pre-authorized code flow
   */
  const requestWithPreAuthorization = useCallback(async (
    preAuthorizedCode: string,
    txCodeInput?: string
  ): Promise<OID4VCIFlowResult> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // WebSocket transport
      if (transportType === 'websocket' && transport) {
        const unsubscribeProgress = onProgress 
          ? transport.onProgress(onProgress) 
          : () => {};
        
        try {
          const result = await transport.startOID4VCIFlow({
            preAuthorizedCode,
            txCodeInput,
          });
          return result;
        } finally {
          unsubscribeProgress();
        }
      }
      
      // HTTP transport: use existing implementation
      // Note: requestCredentialsWithPreAuthorization requires additional params
      // that need to be tracked from the initial handleCredentialOffer call
      if (transportType === 'http' && openID4VCI) {
        // The existing implementation stores state internally,
        // but the interface needs credentialIssuer and selectedCredentialConfigurationId
        // This is a limitation of the current architecture that would need
        // state management to be refactored
        throw new Error(
          'Pre-authorization flow via HTTP transport requires ' +
          'additional state management. Use the existing OpenID4VCI context directly.'
        );
      }
      
      throw new Error('No transport available');
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      return {
        success: false,
        error: {
          code: 'PREAUTH_ERROR',
          message: error.message,
        },
      };
    } finally {
      setIsLoading(false);
    }
  }, [transportType, transport, openID4VCI, onProgress, onError]);
  
  return {
    handleCredentialOffer,
    handleAuthorizationResponse,
    requestWithPreAuthorization,
    transportType,
    isLoading,
    error,
    clearError,
  };
}

export default useOID4VCIFlow;
