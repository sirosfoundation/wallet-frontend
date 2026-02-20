/**
 * Flow Transport Context
 * 
 * This context provides the transport abstraction to React components.
 * It handles transport selection, lifecycle management, and provides
 * hooks for accessing the active transport.
 */

import React, { createContext, useContext, useMemo, useEffect, useState, useCallback } from 'react';
import type { IFlowTransport } from '@/lib/transport/IFlowTransport';
import { nullTransport } from '@/lib/transport/IFlowTransport';
import { HttpProxyTransport } from '@/lib/transport/HttpProxyTransport';
import { WebSocketTransport } from '@/lib/transport/WebSocketTransport';
import { useHttpProxy } from '@/lib/services/HttpProxy/HttpProxy';
import { 
  WS_URL, 
  HTTP_TRANSPORT_ALLOWED, 
  WEBSOCKET_TRANSPORT_ALLOWED,
  DIRECT_TRANSPORT_ALLOWED,
  TRANSPORT_PREFERENCE,
  TransportType,
} from '@/config';

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
  /** List of available transports based on configuration */
  availableTransports: TransportType[];
  /** Error from the last transport operation */
  lastError: Error | null;
  /** Clear the last error */
  clearError: () => void;
}

const FlowTransportContext = createContext<FlowTransportContextValue | null>(null);

interface FlowTransportProviderProps {
  children: React.ReactNode;
  /** Auth token for WebSocket connection */
  authToken: string | null;
}

/**
 * Provider component for the transport context
 */
export const FlowTransportProvider: React.FC<FlowTransportProviderProps> = ({ 
  children, 
  authToken 
}) => {
  const httpProxy = useHttpProxy();
  
  const [isConnected, setIsConnected] = useState(false);
  const [wsTransport, setWsTransport] = useState<WebSocketTransport | null>(null);
  const [lastError, setLastError] = useState<Error | null>(null);
  
  // Determine which transports are available based on config
  const availableTransports = useMemo(() => {
    const available: TransportType[] = [];
    if (HTTP_TRANSPORT_ALLOWED) available.push('http');
    if (WEBSOCKET_TRANSPORT_ALLOWED && WS_URL) available.push('websocket');
    if (DIRECT_TRANSPORT_ALLOWED) available.push('direct');
    return available;
  }, []);
  
  // Create HTTP transport only if allowed
  const httpTransport = useMemo(() => {
    if (!HTTP_TRANSPORT_ALLOWED) return null;
    return new HttpProxyTransport(httpProxy);
  }, [httpProxy]);
  
  // Create and manage WebSocket transport
  useEffect(() => {
    if (!WEBSOCKET_TRANSPORT_ALLOWED || !WS_URL || !authToken) {
      setWsTransport(null);
      return;
    }
    
    const ws = new WebSocketTransport(WS_URL, authToken);
    setWsTransport(ws);
    
    // Connect to WebSocket
    ws.connect()
      .then(() => {
        setIsConnected(true);
        setLastError(null);
      })
      .catch((error) => {
        console.error('WebSocket connection failed:', error);
        setIsConnected(false);
        setLastError(error);
      });
    
    // Subscribe to errors
    const unsubscribeError = ws.onError((error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
      setLastError(error);
    });
    
    return () => {
      unsubscribeError();
      ws.disconnect();
    };
  }, [authToken]);
  
  // Update auth token on WebSocket when it changes
  useEffect(() => {
    if (wsTransport && authToken) {
      wsTransport.updateAuthToken(authToken);
    }
  }, [wsTransport, authToken]);
  
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
        case 'http':
          if (httpTransport) {
            return { transport: httpTransport, transportType: 'http' as const };
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
  
  const value = useMemo(() => ({
    transport,
    transportType,
    isConnected: transportType === 'websocket' ? isConnected : transportType === 'http',
    reconnect,
    availableTransports,
    lastError,
    clearError,
  }), [transport, transportType, isConnected, reconnect, availableTransports, lastError, clearError]);
  
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
