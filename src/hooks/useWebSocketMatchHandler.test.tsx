import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useWebSocketMatchHandler } from './useWebSocketMatchHandler';
import type { MatchRequest, MatchResponse } from '@/lib/openid-flow/transports/OIDFlowWebSocketTransport';

const mocks = vi.hoisted(() => ({
	matchCredentials: vi.fn(),
	registerMatchHandler: vi.fn(),
	credentials: {
		vcEntityList: [] as unknown[] | null,
		fetchVcData: vi.fn(),
	},
	transport: { transportType: 'websocket' },
}));

vi.mock('@/lib/services/CredentialMatchingService', () => ({
	matchCredentials: mocks.matchCredentials,
}));

vi.mock('@/context/CredentialsContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext(mocks.credentials) };
});

vi.mock('@/context/OIDFlowTransportContext', () => ({
	useOIDFlowTransportSafe: () => ({
		transportType: mocks.transport.transportType,
		registerMatchHandler: mocks.registerMatchHandler,
	}),
}));

const dcqlQuery = { credentials: [{ id: 'pid', format: 'dc+sd-jwt' }] };

function request(): MatchRequest {
	return { flowId: 'flow-1', messageId: 'msg-1', dcqlQuery: dcqlQuery as MatchRequest['dcqlQuery'] };
}

/** The handler the hook registered with the transport. */
async function registeredHandler(): Promise<(req: MatchRequest) => Promise<MatchResponse>> {
	await waitFor(() => expect(mocks.registerMatchHandler).toHaveBeenCalled());
	return mocks.registerMatchHandler.mock.calls[0][0];
}

describe('useWebSocketMatchHandler', () => {
	beforeEach(() => {
		mocks.transport.transportType = 'websocket';
		mocks.credentials.vcEntityList = [];
		mocks.credentials.fetchVcData = vi.fn();
		mocks.registerMatchHandler.mockReset();
		mocks.registerMatchHandler.mockReturnValue(vi.fn());
		mocks.matchCredentials.mockReset();
	});

	it('answers a match request with the result of local DCQL matching', async () => {
		const credentials = [{ credentialId: 1 }];
		mocks.credentials.vcEntityList = credentials;
		mocks.matchCredentials.mockReturnValue({
			matches: [{ input_descriptor_id: 'pid', credential_id: '1', format: 'dc+sd-jwt' }],
		});

		renderHook(() => useWebSocketMatchHandler());

		const response = await (await registeredHandler())(request());

		expect(mocks.matchCredentials).toHaveBeenCalledWith(credentials, dcqlQuery);
		expect(response.matches).toHaveLength(1);
	});

	it('reports no match with a reason when the wallet holds nothing that matches', async () => {
		mocks.matchCredentials.mockReturnValue({
			matches: [],
			code: 'NO_MATCHING_CREDENTIALS',
			no_match_reason: 'No credentials match DCQL query',
		});

		renderHook(() => useWebSocketMatchHandler());

		const response = await (await registeredHandler())(request());

		expect(response).toEqual({
			matches: [],
			code: 'NO_MATCHING_CREDENTIALS',
			no_match_reason: 'No credentials match DCQL query',
		});
	});

	it('loads the credentials before answering when they are not loaded yet', async () => {
		const credentials = [{ credentialId: 1 }];
		mocks.credentials.vcEntityList = null;
		mocks.credentials.fetchVcData = vi.fn().mockResolvedValue(credentials);
		mocks.matchCredentials.mockReturnValue({ matches: [] });

		renderHook(() => useWebSocketMatchHandler());

		await (await registeredHandler())(request());

		expect(mocks.credentials.fetchVcData).toHaveBeenCalled();
		expect(mocks.matchCredentials).toHaveBeenCalledWith(credentials, dcqlQuery);
	});

	it('does not claim a no-match when the credentials cannot be loaded', async () => {
		mocks.credentials.vcEntityList = null;
		mocks.credentials.fetchVcData = vi.fn().mockResolvedValue(null);

		renderHook(() => useWebSocketMatchHandler());

		const response = await (await registeredHandler())(request());

		expect(mocks.matchCredentials).not.toHaveBeenCalled();
		expect(response.no_match_reason).toBe('Credentials are not loaded yet');
	});

	it('registers nothing on a non-WebSocket transport', () => {
		mocks.transport.transportType = 'http_proxy';

		renderHook(() => useWebSocketMatchHandler());

		expect(mocks.registerMatchHandler).not.toHaveBeenCalled();
	});

	it('unregisters the handler on unmount', async () => {
		const unsubscribe = vi.fn();
		mocks.registerMatchHandler.mockReturnValue(unsubscribe);

		const { unmount } = renderHook(() => useWebSocketMatchHandler());
		await registeredHandler();

		unmount();

		expect(unsubscribe).toHaveBeenCalled();
	});
});
