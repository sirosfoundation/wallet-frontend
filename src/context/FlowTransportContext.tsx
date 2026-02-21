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
import type { IFlowTransport } from '@/lib/transport/IFlowTransport';
import { nullTransport } from '@/lib/transport/IFlowTransport';
import { HttpProxyTransport } from '@/lib/transport/HttpProxyTransport';
import { WebSocketTransport } from '@/lib/transport/WebSocketTransport';
import { useHttpProxy } from '@/lib/services/HttpProxy/HttpProxy';
import { 
  isWebSocketAvailable, 
  Capabilities,
  getEngineCapabilities,
} from '@/lib/services/CapabilitiesService';
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
        console.warn('Failed to fetch engine capabilities:', error);
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
    if (HTTP_TRANSPORT_ALLOWED) available.push('http');
    // Only add websocket if config allows AND engine has capability
    if (WEBSOCKET_TRANSPORT_ALLOWED && WS_URL && wsCapabilityAvailable) {
      available.push('websocket');
    }
    if (DIRECT_TRANSPORT_ALLOWED) available.push('direct');
    return available;
  }, [wsCapabilityAvailable]);
  
  // Create HTTP transport only if allowed
  const httpTransport = useMemo(() => {
    if (!HTTP_TRANSPORT_ALLOWED) return null;
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
  }, [authToken, capabilitiesLoaded, wsCapabilityAvailable]);
  
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
    capabilitiesLoaded,
    engineCapabilities,
  }), [transport, transportType, isConnected, reconnect, availableTransports, lastError, clearError, capabilitiesLoaded, engineCapabilities]);
  
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
