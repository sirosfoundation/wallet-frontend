/**
 * WebSocket Sign Handler Hook
 *
 * This hook registers a sign handler with the WebSocket transport that uses
 * the session keystore for cryptographic operations.
 *
 * When the backend sends a sign_request, this handler:
 * - For 'generate_proof': Generates an OID4VCI proof JWT
 * - For 'sign_presentation': Generates a VP JWT for OID4VP
 */

import { useEffect, useContext, useCallback } from 'react';
import { useFlowTransportSafe, SignRequest, SignResponse } from '@/context/FlowTransportContext';
import SessionContext from '@/context/SessionContext';
import { useApi } from '@/api';
import StatusContext from '@/context/StatusContext';

/**
 * Hook that registers a sign handler with the WebSocket transport.
 * Should be used within both SessionContext and FlowTransportContext.
 */
export function useWebSocketSignHandler(): void {
  const transportContext = useFlowTransportSafe();
  const sessionContext = useContext(SessionContext);
  const { isOnline } = useContext(StatusContext);
  const api = useApi(isOnline);

  const keystore = sessionContext?.keystore;
  const registerSignHandler = transportContext?.registerSignHandler;
  const transportType = transportContext?.transportType;

  // Sign handler callback
  const handleSignRequest = useCallback(async (request: SignRequest): Promise<SignResponse> => {
    if (!keystore) {
      throw new Error('Keystore not available');
    }

    console.log('[WS Sign Handler] Received sign request:', request.action);

    switch (request.action) {
      case 'generate_proof': {
        // Generate OID4VCI proof JWT
        const { audience, nonce } = request.params;
        if (!audience || !nonce) {
          throw new Error('Missing audience or nonce for proof generation');
        }

        // Use the keystore's generateOpenid4vciProofs method
        // This generates a proof and optionally creates a new key pair
        const [{ proof_jwts: [proofJwt] }, newPrivateData, keystoreCommit] =
          await keystore.generateOpenid4vciProofs([{
            nonce,
            audience,
            issuer: audience, // The audience is typically the issuer for VCI proofs
          }]);

        // Persist any key changes
        await api.updatePrivateData(newPrivateData);
        await keystoreCommit();

        console.log('[WS Sign Handler] Generated proof JWT');
        return { proofJwt };
      }

      case 'sign_presentation': {
        // Generate VP JWT for OID4VP
        const { audience, nonce, credentialsToInclude } = request.params;
        if (!audience || !nonce) {
          throw new Error('Missing audience or nonce for presentation signing');
        }

        // Get the credentials to include
        // Note: credentialsToInclude contains credential IDs that need to be
        // mapped to actual credential data. For now, we pass the structure
        // and let the keystore handle it.
        const verifiableCredentials = credentialsToInclude?.map(c => ({
          credentialId: c.credentialId,
          disclosedClaims: c.disclosedClaims,
        })) || [];

        // Use the keystore's signJwtPresentation method
        const { vpjwt } = await keystore.signJwtPresentation(
          nonce,
          audience,
          verifiableCredentials
        );

        console.log('[WS Sign Handler] Signed VP JWT');
        return { vpToken: vpjwt };
      }

      default:
        throw new Error(`Unknown sign action: ${request.action}`);
    }
  }, [keystore, api]);

  // Register the sign handler when transport is websocket
  useEffect(() => {
    if (transportType !== 'websocket' || !registerSignHandler || !keystore) {
      return;
    }

    console.log('[WS Sign Handler] Registering sign handler');
    const unsubscribe = registerSignHandler(handleSignRequest);

    return () => {
      console.log('[WS Sign Handler] Unregistering sign handler');
      unsubscribe();
    };
  }, [transportType, registerSignHandler, keystore, handleSignRequest]);
}

export default useWebSocketSignHandler;
