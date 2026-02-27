/**
 * Hybrid OID4VP Flow Hook
 *
 * This hook provides a unified interface for verifiable presentation flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useState } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import type {
  OID4VPFlowParams,
  OID4VPFlowResult,
  OID4VPSelectedCredential,
} from '@/lib/transport/types/OID4VPTypes';
import type { FlowProgressEvent } from '@/lib/transport/types/FlowTypes';
import type { OID4VPStep, OID4VPStepInfo } from '@/lib/transport/types/ProtocolSteps';
import { OID4VP_STEP_INFO } from '@/lib/transport/types/ProtocolSteps';

export interface UseOID4VPFlowOptions {
  /** Called when flow progress updates */
  onProgress?: (event: FlowProgressEvent) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseOID4VPFlowReturn {
  /** Start an OID4VP flow with an authorization request URI */
  handleAuthorizationRequest: (
    authorizationRequestUri: string
  ) => Promise<OID4VPFlowResult>;

  /** Send authorization response with selected credentials */
  sendAuthorizationResponse: (
    selectedCredentials: OID4VPSelectedCredential[]
  ) => Promise<OID4VPFlowResult>;

  /** Current transport type being used */
  transportType: 'http' | 'websocket' | 'direct' | 'none';

  /** Whether a flow is currently in progress */
  isLoading: boolean;

  /** Current protocol step */
  currentStep: OID4VPStep;

  /** Metadata for the current step (message, progress, etc.) */
  stepInfo: OID4VPStepInfo;

  /** Last error if any */
  error: Error | null;

  /** Clear the last error */
  clearError: () => void;
}

/**
 * Hook for verifiable presentation flows with transport abstraction
 *
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VP implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VPFlow(options: UseOID4VPFlowOptions = {}): UseOID4VPFlowReturn {
  const { onProgress, onError } = options;

  const transportContext = useFlowTransportSafe();
  const { openID4VP } = useContext(OpenID4VPContext);
  const { vcEntityList } = useContext(CredentialsContext) as { vcEntityList: ExtendedVcEntity[] };

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentStep, setCurrentStep] = useState<OID4VPStep>('idle');

  const transportType = transportContext?.transportType ?? 'none';
  const stepInfo = OID4VP_STEP_INFO[currentStep];
  const transport = transportContext?.transport;

  const clearError = useCallback(() => {
    setError(null);
    setCurrentStep('idle');
    transportContext?.clearError?.();
  }, [transportContext]);

  /**
   * Handle authorization request using the appropriate transport
   */
  const handleAuthorizationRequest = useCallback(async (
    authorizationRequestUri: string
  ): Promise<OID4VPFlowResult> => {
    setIsLoading(true);
    setError(null);
    setCurrentStep('parsing_request');

    try {
      // WebSocket transport: delegate to backend
      if (transportType === 'websocket' && transport) {
        const unsubscribeProgress = onProgress
          ? transport.onProgress(onProgress)
          : () => {};
        const unsubscribeError = onError
          ? transport.onError(onError)
          : () => {};

        try {
          const result = await transport.startOID4VPFlow({
            authorizationRequestUri,
          });
          return result;
        } finally {
          unsubscribeProgress();
          unsubscribeError();
        }
      }

      // HTTP transport: use existing implementation
      if (transportType === 'http' && openID4VP) {
        try {
          setCurrentStep('fetching_verifier_metadata');
          const result = await openID4VP.handleAuthorizationRequest(
            authorizationRequestUri,
            vcEntityList || []
          );

          // Check for error response
          if ('error' in result) {
            setCurrentStep('error');
            return {
              success: false,
              error: {
                code: result.error.code || 'VP_ERROR',
                message: result.error.message || 'Unknown error',
              },
            };
          }

          // Successfully parsed request, now awaiting credential selection
          setCurrentStep('awaiting_credential_selection');

          // Convert to OID4VPFlowResult format
          // The conformantCredentialsMap is a Map<string, any>
          const conformantCredentials = result.conformantCredentialsMap;

          return {
            success: true,
            conformantCredentials,
            verifierInfo: {
              name: result.verifierDomainName,
              purpose: result.verifierPurpose,
              domain: result.verifierDomainName,
            },
            transactionData: result.parsedTransactionData?.map(td => ({
              type: 'transaction',
              description: String(td),
              data: td,
            })),
          };
        } catch (err) {
          throw err;
        }
      }

      // No transport available
      throw new Error('No transport available for verifiable presentation');

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setCurrentStep('error');
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
  }, [transportType, transport, openID4VP, vcEntityList, onProgress, onError]);

  /**
   * Send authorization response with selected credentials
   */
  const sendAuthorizationResponse = useCallback(async (
    selectedCredentials: OID4VPSelectedCredential[]
  ): Promise<OID4VPFlowResult> => {
    setIsLoading(true);
    setError(null);
    setCurrentStep('creating_presentation');

    try {
      // WebSocket transport: continue flow on backend
      if (transportType === 'websocket' && transport) {
        const unsubscribeProgress = onProgress
          ? transport.onProgress(onProgress)
          : () => {};

        try {
          const result = await transport.startOID4VPFlow({
            selectedCredentials,
          });
          return result;
        } finally {
          unsubscribeProgress();
        }
      }

      // HTTP transport: use existing implementation
      if (transportType === 'http' && openID4VP) {
        // Convert OID4VPSelectedCredential[] to Map<string, number>
        // The existing implementation uses descriptor ID -> credential index
        const selectionMap = new Map<string, number>();

        // Note: This assumes the credential indices match vcEntityList
        // In practice, we'd need more sophisticated matching
        selectedCredentials.forEach(cred => {
          // Find the credential index in vcEntityList
          const index = vcEntityList?.findIndex(
            entity => entity.data === cred.credentialRaw
          ) ?? -1;

          if (index !== -1) {
            selectionMap.set(cred.descriptorId, index);
          }
        });

        setCurrentStep('sending_response');
        const result = await openID4VP.sendAuthorizationResponse(
          selectionMap,
          vcEntityList || []
        );

        // Check result type
        if ('url' in result && result.url) {
          setCurrentStep('completed');
          return {
            success: true,
            redirectUri: result.url,
          };
        }

        if ('presentation_during_issuance_session' in result) {
          setCurrentStep('completed');
          return {
            success: true,
            responseData: {
              presentation_during_issuance_session:
                result.presentation_during_issuance_session,
            },
          };
        }

        setCurrentStep('completed');
        return {
          success: true,
        };
      }

      throw new Error('No transport available');

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setCurrentStep('error');
      onError?.(error);
      return {
        success: false,
        error: {
          code: 'RESPONSE_ERROR',
          message: error.message,
        },
      };
    } finally {
      setIsLoading(false);
    }
  }, [transportType, transport, openID4VP, vcEntityList, onProgress, onError]);

  return {
    handleAuthorizationRequest,
    sendAuthorizationResponse,
    transportType,
    isLoading,
    currentStep,
    stepInfo,
    error,
    clearError,
  };
}

export default useOID4VPFlow;
