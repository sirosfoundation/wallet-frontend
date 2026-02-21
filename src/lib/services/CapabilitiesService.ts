/**
 * Backend Capabilities Service
 * 
 * Fetches and caches /status from backend services to discover capabilities.
 * Supports split deployments where backend and engine are separate services.
 */

import { BACKEND_URL, ENGINE_URL } from '@/config';

/**
 * Status response from /status endpoint
 * Matches go-wallet-backend/internal/api/version.go StatusResponse
 */
export interface StatusResponse {
  status: string;
  service: string;
  roles: string[];
  api_version: number;
  capabilities: string[];
}

/**
 * Known capability strings
 */
export const Capabilities = {
  MULTI_TENANCY: 'multi-tenancy',
  WEBAUTHN: 'webauthn',
  STORAGE: 'storage',
  PROXY: 'proxy',
  VCTM_REGISTRY: 'vctm-registry',
  WEBSOCKET: 'websocket',
} as const;

export type Capability = typeof Capabilities[keyof typeof Capabilities];

/**
 * Cached capabilities for each endpoint
 */
interface CachedStatus {
  response: StatusResponse | null;
  fetchedAt: number;
  error: Error | null;
}

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Cache storage
const statusCache = new Map<string, CachedStatus>();

/**
 * Fetch status from an endpoint with caching
 */
async function fetchStatusCached(baseUrl: string): Promise<StatusResponse | null> {
  const now = Date.now();
  const cached = statusCache.get(baseUrl);
  
  // Return cached if fresh
  if (cached && (now - cached.fetchedAt) < CACHE_TTL) {
    if (cached.error) throw cached.error;
    return cached.response;
  }
  
  try {
    const response = await fetch(`${baseUrl}/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      // Old backends without /status endpoint
      if (response.status === 404) {
        const emptyStatus: StatusResponse = {
          status: 'ok',
          service: 'unknown',
          roles: [],
          api_version: 1,
          capabilities: [],
        };
        statusCache.set(baseUrl, {
          response: emptyStatus,
          fetchedAt: now,
          error: null,
        });
        return emptyStatus;
      }
      throw new Error(`Failed to fetch status: ${response.status}`);
    }
    
    const status: StatusResponse = await response.json();
    statusCache.set(baseUrl, {
      response: status,
      fetchedAt: now,
      error: null,
    });
    return status;
    
  } catch (error) {
    // Cache the error to avoid hammering failed endpoints
    statusCache.set(baseUrl, {
      response: null,
      fetchedAt: now,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    // Don't throw - return null to indicate unavailable
    console.warn(`Failed to fetch status from ${baseUrl}:`, error);
    return null;
  }
}

/**
 * Clear the status cache (useful after login/logout)
 */
export function clearStatusCache(): void {
  statusCache.clear();
}

/**
 * Fetch backend status
 */
export async function fetchBackendStatus(): Promise<StatusResponse | null> {
  if (!BACKEND_URL) return null;
  return fetchStatusCached(BACKEND_URL);
}

/**
 * Fetch engine status (for WebSocket capability)
 */
export async function fetchEngineStatus(): Promise<StatusResponse | null> {
  if (!ENGINE_URL) return null;
  return fetchStatusCached(ENGINE_URL);
}

/**
 * Check if a specific capability is available on the backend
 */
export async function hasBackendCapability(capability: Capability): Promise<boolean> {
  const status = await fetchBackendStatus();
  return status?.capabilities?.includes(capability) ?? false;
}

/**
 * Check if a specific capability is available on the engine
 */
export async function hasEngineCapability(capability: Capability): Promise<boolean> {
  const status = await fetchEngineStatus();
  return status?.capabilities?.includes(capability) ?? false;
}

/**
 * Check if WebSocket transport is available (engine has websocket capability)
 */
export async function isWebSocketAvailable(): Promise<boolean> {
  return hasEngineCapability(Capabilities.WEBSOCKET);
}

/**
 * Get all engine capabilities
 */
export async function getEngineCapabilities(): Promise<string[]> {
  const status = await fetchEngineStatus();
  return status?.capabilities ?? [];
}

/**
 * Get all backend capabilities
 */
export async function getBackendCapabilities(): Promise<string[]> {
  const status = await fetchBackendStatus();
  return status?.capabilities ?? [];
}
