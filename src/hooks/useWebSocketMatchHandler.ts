/**
 * WebSocket Match Handler Hook
 *
 * Registers a credential match handler with the WebSocket transport.
 *
 * When the engine sends a `match_request`, the wallet answers it locally:
 * the DCQL query is evaluated against the credentials this wallet holds and
 * only the matching credential ids/types are reported back - the credentials
 * themselves never leave the device.
 *
 * Without a handler the transport answers every `match_request` with an empty
 * match set and "No match handler available", i.e. the wallet could not report
 * a genuine match result at all.
 */

import { useCallback, useContext, useEffect } from 'react';
import { useOIDFlowTransportSafe } from '@/context/OIDFlowTransportContext';
import CredentialsContext from '@/context/CredentialsContext';
import { matchCredentials } from '@/lib/services/CredentialMatchingService';
import type { MatchRequest, MatchResponse } from '@/lib/openid-flow/transports/OIDFlowWebSocketTransport';
import { logger } from '@/logger';

/**
 * Hook that registers a match handler with the WebSocket transport.
 * Should be used within both CredentialsContext and OIDFlowTransportContext.
 */
export function useWebSocketMatchHandler(): void {
	const transportContext = useOIDFlowTransportSafe();
	const { vcEntityList, fetchVcData } = useContext(CredentialsContext);
	const registerMatchHandler = transportContext?.registerMatchHandler;
	const transportType = transportContext?.transportType;

	const handleMatchRequest = useCallback(async (request: MatchRequest): Promise<MatchResponse> => {
		// vcEntityList is null until the credential engine has parsed the
		// store; a request that arrives first must not be answered "no match".
		const credentials = vcEntityList ?? await fetchVcData();

		if (!credentials) {
			return { matches: [], no_match_reason: 'Credentials are not loaded yet' };
		}

		const result = matchCredentials(credentials, request.dcqlQuery);

		logger.debug('[WS Match Handler] Matched credentials', {
			flowId: request.flowId,
			matchCount: result.matches.length,
			code: result.code,
		});

		return result;
	}, [vcEntityList, fetchVcData]);

	useEffect(() => {
		if (transportType !== 'websocket' || !registerMatchHandler) {
			return;
		}

		logger.debug('[WS Match Handler] Registering match handler');
		const unsubscribe = registerMatchHandler(handleMatchRequest);

		return () => {
			logger.debug('[WS Match Handler] Unregistering match handler');
			unsubscribe();
		};
	}, [transportType, registerMatchHandler, handleMatchRequest]);
}

export default useWebSocketMatchHandler;
