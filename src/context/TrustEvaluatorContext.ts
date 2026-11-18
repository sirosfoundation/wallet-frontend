/**
 * The trust evaluators, independent of any transport. The evaluators
 * call the backend's AuthZEN endpoints through the HTTP client — they
 * need nothing from the WebSocket transport, and routes that run
 * before a transport connects (the DC-API callback page) need them
 * just as much as the main app does.
 *
 * Created as a separate context from OIDFlowTransportContext so the
 * DC-API callback can evaluate trust without requiring a connected
 * transport.
 */

import { createContext, useContext } from 'react';
import type { TrustEvaluators } from '@/lib/openid-flow';

export const TrustEvaluatorContext = createContext<TrustEvaluators | null>(null);

export function useTrustEvaluators(): TrustEvaluators | null {
	return useContext(TrustEvaluatorContext);
}
