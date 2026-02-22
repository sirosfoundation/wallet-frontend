/**
 * WebSocket Sign Handler Provider
 *
 * This component sets up the sign handler for WebSocket transport.
 * It should be placed inside both SessionContext and FlowTransportContext.
 */

import React from 'react';
import { useWebSocketSignHandler } from '@/hooks/useWebSocketSignHandler';

interface WebSocketSignHandlerProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that activates the WebSocket sign handler.
 * Renders children unchanged - only side effect is registering the handler.
 */
export const WebSocketSignHandlerProvider: React.FC<WebSocketSignHandlerProviderProps> = ({
  children,
}) => {
  // Register the sign handler
  useWebSocketSignHandler();

  return <>{children}</>;
};

export default WebSocketSignHandlerProvider;
