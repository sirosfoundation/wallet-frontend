/**
 * WebSocket Match Handler Provider
 *
 * This component sets up the credential match handler for WebSocket transport.
 * It should be placed inside both CredentialsContext and OIDFlowTransportContext.
 */

import React from 'react';
import { useWebSocketMatchHandler } from '@/hooks/useWebSocketMatchHandler';

interface WebSocketMatchHandlerProviderProps {
	children: React.ReactNode;
}

/**
 * Provider component that activates the WebSocket match handler.
 * Renders children unchanged - only side effect is registering the handler.
 */
export const WebSocketMatchHandlerProvider: React.FC<WebSocketMatchHandlerProviderProps> = ({
	children,
}) => {
	// Register the match handler
	useWebSocketMatchHandler();

	return <>{children}</>;
};

export default WebSocketMatchHandlerProvider;
