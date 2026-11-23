import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import SessionContext from './SessionContext';
import { OIDFlowTransportProvider, useOIDFlowTransport } from './OIDFlowTransportContext';

// vi.mock factories are hoisted above the imports, so what they share with
// the tests has to be hoisted too.
const { connect, wasmConnect, wasmDisconnect, wmpConnect, wmpCreated, flags, httpClient } = vi.hoisted(() => ({
	connect: vi.fn(async () => {}),
	wasmConnect: vi.fn(async () => {}),
	wasmDisconnect: vi.fn(async () => {}),
	wmpConnect: vi.fn(async () => {}),
	wmpCreated: [] as unknown[][],
	flags: { wasm: false, wmp: false },
	// Stable across renders, like the real hook: a new object each time would
	// rebuild trustEvaluators and re-run the WebSocket effect forever.
	httpClient: {},
}));

vi.mock('@/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/config')>()),
	WS_URL: 'wss://wallet.example.org/api/v2/wallet',
	HTTP_PROXY_TRANSPORT_ALLOWED: false,
	WEBSOCKET_TRANSPORT_ALLOWED: true,
	DIRECT_TRANSPORT_ALLOWED: false,
	TRANSPORT_PREFERENCE: ['websocket'],
	BACKEND_URL: 'https://wallet.example.org',
	get WASM_ENGINE_ENABLED() { return flags.wasm; },
	get WMP_ENABLED() { return flags.wmp; },
	WMP_URL: 'https://wallet.example.org/api/v2/wallet/rpc',
}));

vi.mock('@/lib/services/CapabilitiesService', () => ({
	Capabilities: { WEBSOCKET: 'websocket' },
	getEngineCapabilities: vi.fn(async () => ['websocket']),
}));

vi.mock('@/hooks/useHttpClient', () => ({
	useHttpClient: () => httpClient,
}));

vi.mock('@/hooks/useWscdManagerClient', () => ({
	useWscdManagerClient: () => null,
}));

// A stand-in for the in-browser engine, keeping its generated package out of the import graph.
vi.mock('@/lib/openid-flow/transports/OIDFlowWasmTransport', () => ({
	OIDFlowWasmTransport: class {
		connect = wasmConnect;
		disconnect = wasmDisconnect;
		updateAuthToken = vi.fn();
		resetReconnectAttempts = vi.fn();
		onError = vi.fn(() => () => {});
		isConnected = vi.fn(() => true);
		onSignRequest = vi.fn(() => () => {});
		onMatchRequest = vi.fn(() => () => {});
	},
}));

vi.mock('@/lib/openid-flow/transports/OIDFlowWmpTransport', () => ({
	OIDFlowWmpTransport: class {
		constructor(...args: unknown[]) { wmpCreated.push(args); }
		connect = wmpConnect;
		disconnect = vi.fn();
		onError = vi.fn(() => () => {});
		isConnected = vi.fn(() => true);
		updateAuthToken = vi.fn();
		resetReconnectAttempts = vi.fn();
		onSignRequest = vi.fn(() => () => {});
		onMatchRequest = vi.fn(() => () => {});
	},
}));

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

describe('OIDFlowTransportProvider transportReady', () => {
	beforeEach(() => {
		connect.mockClear();
		wasmConnect.mockClear();
		wasmDisconnect.mockClear();
		wmpConnect.mockClear();
		wmpCreated.length = 0;
		flags.wasm = false;
		flags.wmp = false;
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

	// The in-browser engine asks for a token on each request. A first token
	// request that fails (a 401 while the session is still being restored, on
	// a page opened from an offer link) must not leave the wallet without a
	// transport: the context asks for that token only once.
	it('starts the in-browser engine even when the first token request fails', async () => {
		flags.wasm = true;
		const { result } = renderTransport(() => Promise.reject(new Error('401')));

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(wasmConnect).toHaveBeenCalled();
		expect(connect).not.toHaveBeenCalled();
		expect(result.current.transportType).toBe('websocket');
	});

	it('waits for the in-browser engine to start before reporting ready', async () => {
		flags.wasm = true;
		const started = deferred<void>();
		wasmConnect.mockImplementationOnce(() => started.promise);
		const { result } = renderTransport(async () => ({ raw: 'backend-token' }));

		await act(async () => { await Promise.resolve(); });
		expect(result.current.transportReady).toBe(false);

		await act(async () => { started.resolve(); });
		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(result.current.transportType).toBe('websocket');
	});

	it('runs the flows on the remote engine over WMP when WMP is enabled', async () => {
		flags.wmp = true;
		const { result } = renderTransport(async () => ({ raw: 'backend-token' }));

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(wmpCreated).toHaveLength(1);
		expect(wmpCreated[0].slice(0, 3)).toEqual([
			'https://wallet.example.org/api/v2/wallet/rpc',
			'wss://wallet.example.org/api/v2/wallet',
			'backend-token',
		]);
		expect(wmpConnect).toHaveBeenCalled();
		expect(connect).not.toHaveBeenCalled();
		expect(result.current.transportType).toBe('websocket');
	});

	it('prefers the in-browser engine when both it and WMP are enabled', async () => {
		flags.wasm = true;
		flags.wmp = true;
		const { result } = renderTransport(async () => ({ raw: 'backend-token' }));

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(wasmConnect).toHaveBeenCalled();
		expect(wmpCreated).toHaveLength(0);
		expect(connect).not.toHaveBeenCalled();
	});

	it('does not start the in-browser engine while logged out', async () => {
		flags.wasm = true;
		const { result } = renderTransport(async () => ({ raw: 'backend-token' }), { loggedIn: false });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(wasmConnect).not.toHaveBeenCalled();
		expect(result.current.transportType).not.toBe('websocket');
	});

	it('starts the in-browser engine on login and tears it down on logout', async () => {
		flags.wasm = true;
		const { result, setLoggedIn } = renderTransport(async () => ({ raw: 'backend-token' }), { loggedIn: false });
		await waitFor(() => expect(result.current.transportReady).toBe(true));

		await setLoggedIn(true);
		await waitFor(() => expect(result.current.transportType).toBe('websocket'));
		expect(wasmConnect).toHaveBeenCalledTimes(1);

		await setLoggedIn(false);
		await waitFor(() => expect(wasmDisconnect).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(result.current.transportType).not.toBe('websocket'));
		expect(result.current.isConnected).toBe(false);
	});

	it('does not request a backend token while logged out', async () => {
		const ensureBackendToken = vi.fn(async () => ({ raw: 'backend-token' }));
		const { result } = renderTransport(ensureBackendToken, { loggedIn: false });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(ensureBackendToken).not.toHaveBeenCalled();
		expect(connect).not.toHaveBeenCalled();
	});

	// AuthTokens is the same instance before and after login, so logging in
	// must be enough on its own to trigger token resolution.
	it('resolves the backend token once the user logs in', async () => {
		const ensureBackendToken = vi.fn(async () => ({ raw: 'backend-token' }));
		const { result, setLoggedIn } = renderTransport(ensureBackendToken, { loggedIn: false });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(ensureBackendToken).not.toHaveBeenCalled();

		await setLoggedIn(true);

		await waitFor(() => expect(result.current.transportType).toBe('websocket'));
		expect(ensureBackendToken).toHaveBeenCalledTimes(1);
		expect(connect).toHaveBeenCalled();
	});

	it('ignores a backend token that resolves after logout', async () => {
		const token = deferred<{ raw: string }>();
		const { result, setLoggedIn } = renderTransport(() => token.promise);

		await act(async () => { await Promise.resolve(); });
		expect(result.current.transportReady).toBe(false);

		await setLoggedIn(false);
		await act(async () => { token.resolve({ raw: 'backend-token' }); });

		await waitFor(() => expect(result.current.transportReady).toBe(true));
		expect(connect).not.toHaveBeenCalled();
		expect(result.current.transportType).not.toBe('websocket');
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function renderTransport(
	ensureBackendToken: () => Promise<{ raw: string }>,
	{ loggedIn = true }: { loggedIn?: boolean } = {},
) {
	// One instance for the whole render, like the memoized AuthTokens in SessionContextProvider.
	const authTokens = { ensureBackendToken };
	let setIsLoggedIn!: (value: boolean) => void;

	const Wrapper = ({ children }: { children: React.ReactNode }) => {
		const [isLoggedIn, setState] = React.useState(loggedIn);
		setIsLoggedIn = setState;
		const session = React.useMemo(() => ({ authTokens, isLoggedIn }) as any, [isLoggedIn]);
		return (
			<SessionContext.Provider value={session}>
				<OIDFlowTransportProvider>{children}</OIDFlowTransportProvider>
			</SessionContext.Provider>
		);
	};

	const rendered = renderHook(() => useOIDFlowTransport(), { wrapper: Wrapper });

	return {
		...rendered,
		setLoggedIn: async (value: boolean) => {
			await act(async () => { setIsLoggedIn(value); });
		},
	};
}
