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

import { useEffect, useContext } from 'react';
import { useOIDFlowTransportSafe } from '@/context/OIDFlowTransportContext';
import SessionContext from '@/context/SessionContext';
import { logger } from '@/logger';
import { useOIDFlowSignHandler } from './useOIDFlowSignHandler';

/**
 * Hook that registers a sign handler with the WebSocket transport.
 * Should be used within both SessionContext and OIDFlowTransportContext.
 */
export function useWebSocketSignHandler(): void {
	const transportContext = useOIDFlowTransportSafe();
	const sessionContext = useContext(SessionContext);
	const keystore = sessionContext?.keystore;
	const registerSignHandler = transportContext?.registerSignHandler;
	const transportType = transportContext?.transportType;
	const { handleSignRequest } = useOIDFlowSignHandler();

	// Register the sign handler when transport is websocket
	useEffect(() => {
		if (transportType !== 'websocket' || !registerSignHandler || !keystore) {
			return;
		}

		logger.debug('[WS Sign Handler] Registering sign handler');
		const unsubscribe = registerSignHandler(handleSignRequest);

		return () => {
			logger.debug('[WS Sign Handler] Unregistering sign handler');
			unsubscribe();
		};
	}, [transportType, registerSignHandler, keystore, handleSignRequest]);
}

export default useWebSocketSignHandler;
