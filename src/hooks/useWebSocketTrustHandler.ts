/**
 * WebSocket Trust Handler Hook
 *
 * This hook registers a trust evaluation handler with the WebSocket transport
 * so that both HTTP proxy and WebSocket paths use the same TrustEvaluator
 * interface for verifier and issuer trust evaluation.
 *
 * When the backend sends a flow_progress with trust_evaluation_required,
 * this handler:
 * - For 'credential_verifier': Calls createTrustEvaluator → AuthZEN /v1/evaluate
 * - For 'credential_issuer': Calls createIssuerTrustEvaluator → AuthZEN /v1/evaluate
 */

import { useEffect, useContext, useCallback } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import type { WSTrustEvaluationRequest, WSTrustEvaluationResponse } from '@/context/FlowTransportContext';
import StatusContext from '@/context/StatusContext';
import { useApi } from '@/api';
import { useHttpProxy } from '@/lib/services/HttpProxy/HttpProxy';
import {
	createTrustEvaluator,
	createIssuerTrustEvaluator,
	createDIDResolver,
} from '@/lib/services/TrustEvaluator';
import type { ClientIdScheme } from '@/lib/services/TrustEvaluator';
import { BACKEND_URL } from '@/config';
import { getTenantFromUrlPath } from '@/lib/tenant';
import { logger } from '@/logger';

/**
 * Parse a subject ID into a ClientIdScheme based on context from the backend.
 * The backend sends client_id_scheme in the context field.
 */
function parseClientIdScheme(subjectId: string, context?: Record<string, unknown>): ClientIdScheme {
	const scheme = context?.client_id_scheme as string | undefined;

	if (scheme === 'did' || subjectId.startsWith('did:')) {
		return { scheme: 'did', clientId: subjectId, identifier: subjectId };
	}
	if (scheme === 'x509_san_dns') {
		return { scheme: 'x509_san_dns', clientId: subjectId, identifier: subjectId };
	}
	if (scheme === 'pre-registered') {
		return { scheme: 'pre-registered', clientId: subjectId, identifier: subjectId };
	}
	// Default: https
	return { scheme: 'https', clientId: subjectId, identifier: subjectId };
}

/**
 * Hook that registers a trust evaluation handler with the WebSocket transport.
 * Should be used within SessionContext, FlowTransportContext, and where
 * useHttpProxy is available.
 */
export function useWebSocketTrustHandler(): void {
	const transportContext = useFlowTransportSafe();
	const { isOnline } = useContext(StatusContext);
	const api = useApi(isOnline);
	const httpProxy = useHttpProxy();

	const registerTrustHandler = transportContext?.registerTrustHandler;
	const transportType = transportContext?.transportType;

	// Trust handler callback
	const handleTrustRequest = useCallback(async (request: WSTrustEvaluationRequest): Promise<WSTrustEvaluationResponse> => {
		logger.debug('[WS Trust Handler] Received trust request:', request.subjectType, request.subjectId);

		const config = {
			httpClient: httpProxy,
			backendUrl: BACKEND_URL,
			getAuthToken: () => api.getAppToken() ?? '',
			tenantId: getTenantFromUrlPath() ?? 'default',
		};

		// Map key material from backend format to TrustEvaluator format
		const keyMaterial = request.keyMaterial
			? { type: request.keyMaterial.type, key: request.keyMaterial.x5c ?? request.keyMaterial.jwk }
			: undefined;

		if (request.subjectType === 'credential_issuer') {
			const evaluateIssuer = createIssuerTrustEvaluator(config);
			const result = await evaluateIssuer({
				issuerId: request.subjectId,
				keyMaterial,
				context: request.context,
			});

			logger.debug('[WS Trust Handler] Issuer trust result:', result.trusted);
			return {
				trusted: result.trusted,
				name: result.name,
				logo: result.logo,
				metadata: result.metadata,
			};
		}

		// credential_verifier: parse client_id_scheme and call verifier trust evaluator
		const clientIdScheme = parseClientIdScheme(request.subjectId, request.context);

		// For DID schemes with requires_resolution, resolve DID document first
		if (request.requiresResolution && clientIdScheme.scheme === 'did') {
			const resolveDid = createDIDResolver(config);
			const resolution = await resolveDid(request.subjectId);
			if (!resolution.resolved) {
				logger.warn('[WS Trust Handler] DID resolution failed:', resolution.error);
				return { trusted: false, reason: `DID resolution failed: ${resolution.error}` };
			}
		}

		const evaluateTrust = createTrustEvaluator(config);
		const result = await evaluateTrust({
			clientIdScheme,
			keyMaterial: keyMaterial ?? { type: 'jwk', key: {} },
			requestUri: request.context?.request_uri as string | undefined,
			responseUri: request.context?.response_uri as string | undefined,
		});

		logger.debug('[WS Trust Handler] Verifier trust result:', result.trusted);
		return {
			trusted: result.trusted,
			name: result.name,
			logo: result.logo,
			metadata: result.metadata,
		};
	}, [httpProxy, api]);

	// Register the trust handler when transport is websocket
	useEffect(() => {
		if (transportType !== 'websocket' || !registerTrustHandler) {
			return;
		}

		logger.debug('[WS Trust Handler] Registering trust handler');
		const unsubscribe = registerTrustHandler(handleTrustRequest);

		return () => {
			logger.debug('[WS Trust Handler] Unregistering trust handler');
			unsubscribe();
		};
	}, [transportType, registerTrustHandler, handleTrustRequest]);
}

export default useWebSocketTrustHandler;
