/**
 * The trust evaluators' provider: creates the evaluator pair and exposes
 * them through TrustEvaluatorContext, independent of any transport. The
 * evaluators call the backend's AuthZEN endpoints through the HTTP client
 * — they need nothing from the WebSocket transport, and routes that run
 * before a transport connects (the DC-API callback page) need them just
 * as much as the main app does.
 *
 * Sits above the transport provider so the evaluators are available on
 * every route. The transport provider consumes them for its WebSocket
 * constructor; the DC-API callback consumes them directly.
 */

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { TrustEvaluatorContext } from './TrustEvaluatorContext';
import { createIssuerTrustEvaluator, createVerifierTrustEvaluator } from '@/lib/services/TrustEvaluator';
import type { TrustEvaluators } from '@/lib/openid-flow';
import { useHttpClient } from '@/hooks/useHttpClient';
import SessionContext from './SessionContext';
import { BACKEND_URL } from '@/config';

export function TrustEvaluatorProvider({ children }: { children: React.ReactNode }) {
	const httpClient = useHttpClient();
	const { authTokens, isLoggedIn } = useContext(SessionContext);
	const tenantId = 'default';

	// Resolve the backend access token — the same mechanism the transport
	// provider uses, kept independent so the evaluators work without one.
	const [authToken, setAuthToken] = useState<string | null>(null);
	useEffect(() => {
		if (!isLoggedIn) {
			setAuthToken(null);
			return;
		}
		let active = true;
		(async () => {
			try {
				const token = await authTokens.ensureBackendToken();
				if (active) setAuthToken(token.raw);
			} catch {
				if (active) setAuthToken(null);
			}
		})();
		return () => { active = false; };
	}, [isLoggedIn, authTokens]);

	const trustEvaluators = useMemo((): TrustEvaluators => {
		const getAuthToken = () => authToken ?? '';
		const evaluateIssuerTrust = createIssuerTrustEvaluator({
			httpClient,
			backendUrl: BACKEND_URL,
			getAuthToken,
			tenantId,
		});
		const evaluateVerifierTrust = createVerifierTrustEvaluator({
			httpClient,
			backendUrl: BACKEND_URL,
			getAuthToken,
			tenantId,
		});
		return { evaluateIssuerTrust, evaluateVerifierTrust };
	}, [tenantId, authToken, httpClient]);

	return (
		<TrustEvaluatorContext.Provider value={trustEvaluators}>
			{children}
		</TrustEvaluatorContext.Provider>
	);
}