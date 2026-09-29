import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/config')>()),
	WS_URL: 'wss://wallet.example.org/api/v2/wallet',
	HTTP_PROXY_TRANSPORT_ALLOWED: false,
	WEBSOCKET_TRANSPORT_ALLOWED: true,
	DIRECT_TRANSPORT_ALLOWED: false,
	TRANSPORT_PREFERENCE: ['websocket'],
	BACKEND_URL: 'https://wallet.example.org',
}));

vi.mock('@/lib/services/CapabilitiesService', () => ({
	Capabilities: { WEBSOCKET: 'websocket' },
	getEngineCapabilities: vi.fn(async () => ['websocket']),
}));

// Stable across renders, like the real hook: a new object each time would
// rebuild trustEvaluators and re-run the WebSocket effect forever.
const httpClient = {};
vi.mock('@/hooks/useHttpClient', () => ({
	useHttpClient: () => httpClient,
}));

const connect = vi.fn(async () => {});
vi.mock('@/lib/openid-flow/transports/OIDFlowWebSocketTransport', () => ({
	OIDFlowWebSocketTransport: class {
		connect = connect;
		disconnect = vi.fn();
		onError = vi.fn(() => () => {});
		isConnected = vi.fn(() => true);
		updateAuthToken = vi.fn();
		resetReconnectAttempts = vi.fn();
		onSignRequest = vi.fn(() => () => {});
		onMatchRequest = vi.fn(() => () => {});
	},
}));

import SessionContext from './SessionContext';
import { OIDFlowTransportProvider, useOIDFlowTransport } from './OIDFlowTransportContext';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function renderTransport(ensureBackendToken: () => Promise<{ raw: string }>) {
	const session = { authTokens: { ensureBackendToken } } as any;
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<SessionContext.Provider value={session}>
			<OIDFlowTransportProvider>{children}</OIDFlowTransportProvider>
		</SessionContext.Provider>
	);
	return renderHook(() => useOIDFlowTransport(), { wrapper });
}

describe('OIDFlowTransportProvider transportReady', () => {
	beforeEach(() => {
		connect.mockClear();
	});

	// A page load such as the credential offer callback starts its flow as
	// soon as transportReady is true. Reporting ready while the backend token
	// is still being fetched started OID4VCI with no transport at all
	// ("No transport available for credential issuance").
	it('is not ready while the backend token is still being resolved', async () => {
		const token = deferred<{ raw: string }>();
		const { result } = renderTransport(() => token.promise);

		// Let the capabilities fetch settle; the token is still pending.
		await act(async () => { await Promise.resolve(); });
		expect(result.current.capabilitiesLoaded).toBe(true);
		expect(result.current.transportReady).toBe(false);

		await act(async () => { token.resolve({ raw: 'backend-token' }); });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(connect).toHaveBeenCalled();
		expect(result.current.transportType).toBe('websocket');
	});

	it('becomes ready without a WebSocket when no backend token can be obtained', async () => {
		const token = deferred<{ raw: string }>();
		const { result } = renderTransport(() => token.promise);

		await act(async () => { await Promise.resolve(); });
		expect(result.current.transportReady).toBe(false);

		await act(async () => { token.reject(new Error('not logged in')); });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(connect).not.toHaveBeenCalled();
	});
});
