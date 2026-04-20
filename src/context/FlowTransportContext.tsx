/**
 * Flow Transport Context
 *
 * This context provides the transport abstraction to React components.
 * It handles transport selection, lifecycle management, and provides
 * hooks for accessing the active transport.
 *
 * The context queries /status on the engine endpoint to discover capabilities
 * before enabling WebSocket transport.
 */

import React, { createContext, useContext, useMemo, useEffect, useState, useCallback } from 'react';
import type { IFlowTransport } from '@/lib/transport/types/IFlowTransport';
import { nullTransport } from '@/lib/transport/types/IFlowTransport';
import { HttpProxyTransport } from '@/lib/transport/HttpProxyTransport';
import { WebSocketTransport } from '@/lib/transport/WebSocketTransport';
import type { SignRequestHandler, MatchRequestHandler } from '@/lib/transport/WebSocketTransport';
import { useHttpProxy } from '@/lib/services/HttpProxy/HttpProxy';
import {
	Capabilities,
	getEngineCapabilities,
} from '@/lib/services/CapabilitiesService';
import {
	WS_URL,
	HTTP_PROXY_TRANSPORT_ALLOWED,
	WEBSOCKET_TRANSPORT_ALLOWED,
	DIRECT_TRANSPORT_ALLOWED,
	TRANSPORT_PREFERENCE,
} from '@/config';
import type { TransportType } from '@/lib/transport/types/FlowTypes';
import { logger } from '@/logger';

// Re-export sign and match types with WS prefix for clarity
export type {
	SignRequest as WSSignRequest,
	SignResponse as WSSignResponse,
	SignRequestHandler as WSSignRequestHandler,
	MatchRequest as WSMatchRequest,
	MatchResponse as WSMatchResponse,
	MatchRequestHandler as WSMatchRequestHandler,
	TrustEvaluationRequest as WSTrustEvaluationRequest,
	TrustEvaluationResponse as WSTrustEvaluationResponse,
	TrustEvaluationHandler as WSTrustEvaluationHandler,
} from '@/lib/transport/WebSocketTransport';

/**
 * Value provided by the FlowTransportContext
 */
interface FlowTransportContextValue {
	/** The active transport instance */
	transport: IFlowTransport;
	/** The type of the active transport */
	transportType: TransportType | 'none';
	/** Whether the transport is currently connected */
	isConnected: boolean;
	/** Attempt to reconnect (for WebSocket) */
	reconnect: () => Promise<void>;
	/** List of available transports based on configuration and capabilities */
	availableTransports: TransportType[];
	/** Error from the last transport operation */
	lastError: Error | null;
	/** Clear the last error */
	clearError: () => void;
	/** Whether capabilities have been loaded from the engine */
	capabilitiesLoaded: boolean;
	/** Engine capabilities (for debugging/display) */
	engineCapabilities: string[];
	/** Register a sign request handler (for WebSocket) */
	registerSignHandler: (handler: SignRequestHandler) => () => void;
	/** Register a match request handler for client-side credential matching (for WebSocket) */
	registerMatchHandler: (handler: MatchRequestHandler) => () => void;
	/** Register a trust evaluation handler for client-side trust evaluation (for WebSocket) */
	registerTrustHandler: (handler: import('@/lib/transport/WebSocketTransport').TrustEvaluationHandler) => () => void;
}

const FlowTransportContext = createContext<FlowTransportContextValue | null>(null);

interface FlowTransportProviderProps {
	children: React.ReactNode;
	/** Auth token for WebSocket connection */
	authToken: string | null;
	/** Tenant ID for multi-tenant routing */
	tenantId: string;
}

/**
 * Provider component for the transport context
 */
export const FlowTransportProvider: React.FC<FlowTransportProviderProps> = ({
	children,
	authToken,
	tenantId
}) => {
	const httpProxy = useHttpProxy();

	const [isConnected, setIsConnected] = useState(false);
	const [wsTransport, setWsTransport] = useState<WebSocketTransport | null>(null);
	const [lastError, setLastError] = useState<Error | null>(null);

	// Engine capabilities state
	const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
	const [engineCapabilities, setEngineCapabilities] = useState<string[]>([]);
	const [wsCapabilityAvailable, setWsCapabilityAvailable] = useState(false);

	// Fetch engine capabilities on mount
	useEffect(() => {
		let cancelled = false;

		async function fetchCapabilities() {
			try {
				const caps = await getEngineCapabilities();
				if (cancelled) return;

				setEngineCapabilities(caps);
				setWsCapabilityAvailable(caps.includes(Capabilities.WEBSOCKET));
				setCapabilitiesLoaded(true);
			} catch (error) {
				logger.warn('Failed to fetch engine capabilities:', error);
				if (!cancelled) {
					setCapabilitiesLoaded(true);
					setWsCapabilityAvailable(false);
				}
			}
		}

		fetchCapabilities();

		return () => {
			cancelled = true;
		};
	}, []);

	// Determine which transports are available based on config AND capabilities
	const availableTransports = useMemo(() => {
		const available: TransportType[] = [];
		if (HTTP_PROXY_TRANSPORT_ALLOWED) available.push('http_proxy');
		// Only add websocket if config allows AND engine has capability
		if (WEBSOCKET_TRANSPORT_ALLOWED && WS_URL && wsCapabilityAvailable) {
			available.push('websocket');
		}
		if (DIRECT_TRANSPORT_ALLOWED) available.push('direct');
		return available;
	}, [wsCapabilityAvailable]);

	// Create HTTP proxy transport only if allowed
	const httpTransport = useMemo(() => {
		if (!HTTP_PROXY_TRANSPORT_ALLOWED) return null;
		return new HttpProxyTransport(httpProxy);
	}, [httpProxy]);

	// Create and manage WebSocket transport (only if capability is available)
	useEffect(() => {
		// Wait for capabilities to load before trying WebSocket
		if (!capabilitiesLoaded) {
			return;
		}

		// Check all conditions: config allows, capability available, URL set, auth token present
		if (!WEBSOCKET_TRANSPORT_ALLOWED || !wsCapabilityAvailable || !WS_URL || !authToken) {
			setWsTransport(null);
			setIsConnected(false);
			return;
		}

		const ws = new WebSocketTransport(WS_URL, authToken, tenantId);
		setWsTransport(ws);

		// Connect to WebSocket
		ws.connect()
			.then(() => {
				setIsConnected(true);
				setLastError(null);
			})
			.catch((error) => {
				logger.error('WebSocket connection failed:', error);
				setIsConnected(false);
				setLastError(error);
			});

		// Subscribe to errors
		const unsubscribeError = ws.onError((error) => {
			logger.error('WebSocket error:', error);
			setIsConnected(false);
			setLastError(error);
		});

		return () => {
			unsubscribeError();
			ws.disconnect();
		};
	}, [authToken, tenantId, capabilitiesLoaded, wsCapabilityAvailable]);

	// Update auth token and tenant ID on WebSocket when they change
	useEffect(() => {
		if (wsTransport && authToken) {
			wsTransport.updateAuthToken(authToken, tenantId);
		}
	}, [wsTransport, authToken, tenantId]);

	// Select active transport based on preference order and availability
	const { transport, transportType } = useMemo(() => {
		// Follow TRANSPORT_PREFERENCE order
		for (const pref of TRANSPORT_PREFERENCE) {
			if (!availableTransports.includes(pref)) continue;

			switch (pref) {
				case 'websocket':
					if (wsTransport && isConnected) {
						return { transport: wsTransport, transportType: 'websocket' as const };
					}
					break;
				case 'http_proxy':
					if (httpTransport) {
						return { transport: httpTransport, transportType: 'http_proxy' as const };
					}
					break;
				case 'direct':
					// Direct transport not yet implemented
					// Will be added when ecosystem supports CORS
					break;
			}
		}

		// No transport available
		return { transport: nullTransport, transportType: 'none' as const };
	}, [availableTransports, wsTransport, isConnected, httpTransport]);

	// Reconnect function for WebSocket
	const reconnect = useCallback(async () => {
		if (wsTransport && WEBSOCKET_TRANSPORT_ALLOWED) {
			try {
				await wsTransport.connect();
				setIsConnected(true);
				setLastError(null);
			} catch (error) {
				setLastError(error instanceof Error ? error : new Error('Reconnection failed'));
				throw error;
			}
		}
	}, [wsTransport]);

	const clearError = useCallback(() => {
		setLastError(null);
	}, []);

	// Register sign handler on WebSocket transport
	const registerSignHandler = useCallback((handler: SignRequestHandler): (() => void) => {
		if (wsTransport) {
			return wsTransport.onSignRequest(handler);
		}
		// Return no-op unsubscribe if no WebSocket transport
		return () => {};
	}, [wsTransport]);

	// Register match handler on WebSocket transport for client-side credential matching
	const registerMatchHandler = useCallback((handler: MatchRequestHandler): (() => void) => {
		if (wsTransport) {
			return wsTransport.onMatchRequest(handler);
		}
		// Return no-op unsubscribe if no WebSocket transport
		return () => {};
	}, [wsTransport]);

	// Register trust handler on WebSocket transport for client-side trust evaluation
	const registerTrustHandler = useCallback((handler: import('@/lib/transport/WebSocketTransport').TrustEvaluationHandler): (() => void) => {
		if (wsTransport) {
			return wsTransport.onTrustEvaluation(handler);
		}
		return () => {};
	}, [wsTransport]);

	const value = useMemo(() => ({
		transport,
		transportType,
		isConnected: transportType === 'websocket' ? isConnected : transportType === 'http_proxy',
		reconnect,
		availableTransports,
		lastError,
		clearError,
		capabilitiesLoaded,
		engineCapabilities,
		registerSignHandler,
		registerMatchHandler,
		registerTrustHandler,
	}), [transport, transportType, isConnected, reconnect, availableTransports, lastError, clearError, capabilitiesLoaded, engineCapabilities, registerSignHandler, registerMatchHandler, registerTrustHandler]);

	return (
		<FlowTransportContext.Provider value={value}>
			{children}
		</FlowTransportContext.Provider>
	);
};

/**
 * Hook to access the flow transport
 *
 * @throws Error if used outside FlowTransportProvider or no transport is configured
 */
export const useFlowTransport = (): FlowTransportContextValue => {
	const context = useContext(FlowTransportContext);

	if (!context) {
		throw new Error('useFlowTransport must be used within FlowTransportProvider');
	}

	return context;
};

/**
 * Hook to access the flow transport with optional error handling
 * Does not throw if no transport is available
 */
export const useFlowTransportSafe = (): FlowTransportContextValue | null => {
	return useContext(FlowTransportContext);
};

export default FlowTransportContext;
