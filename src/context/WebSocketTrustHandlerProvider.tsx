/**
 * WebSocket Trust Handler Provider
 *
 * This component sets up the trust evaluation handler for WebSocket transport.
 * It should be placed inside SessionContext, FlowTransportContext, and where
 * useHttpProxy is available.
 */

import React from 'react';
import { useWebSocketTrustHandler } from '@/hooks/useWebSocketTrustHandler';

interface WebSocketTrustHandlerProviderProps {
	children: React.ReactNode;
}

/**
 * Provider component that activates the WebSocket trust handler.
 * Renders children unchanged - only side effect is registering the handler.
 */
export const WebSocketTrustHandlerProvider: React.FC<WebSocketTrustHandlerProviderProps> = ({
	children,
}) => {
	// Register the trust handler
	useWebSocketTrustHandler();

	return <>{children}</>;
};

export default WebSocketTrustHandlerProvider;
