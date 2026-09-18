import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useOID4VPFlow } from './useOID4VPFlow';
import type { OID4VPFlowResult } from '@/lib/openid-flow/types/OID4VPTypes';
import type { DcqlQuery } from 'dcql';

const mocks = vi.hoisted(() => ({
	matchCredentials: vi.fn(),
	reportNoMatchingCredentials: vi.fn(),
	transport: { transportType: 'websocket' as string },
}));

vi.mock('@/lib/services/CredentialMatchingService', () => ({
	matchCredentials: mocks.matchCredentials,
}));

vi.mock('@/context/OIDFlowTransportContext', () => ({
	useOIDFlowTransportSafe: () => ({
		transportType: mocks.transport.transportType,
		transport: { reportNoMatchingCredentials: mocks.reportNoMatchingCredentials },
	}),
}));

vi.mock('@/context/SessionContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ keystore: {}, api: {} }) };
});

vi.mock('@/context/CredentialsContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ vcEntityList: [] }) };
});

vi.mock('./useOIDFlowSignHandler', () => ({
	useOIDFlowSignHandler: () => ({ signPresentation: vi.fn() }),
}));

const dcqlQuery = {
	credentials: [{ id: 'pid', format: 'dc+sd-jwt', meta: { vct_values: ['urn:eudi:pid:1'] } }],
} as unknown as DcqlQuery.Input;

const verifierInfo = { name: 'Test Verifier' };

/**
 * Run a credential selection the way the presentation page does, with the
 * state updates the hook makes along the way wrapped in act().
 */
async function selectCredentials(): Promise<OID4VPFlowResult> {
	const { result } = renderHook(() => useOID4VPFlow({ onCredentialSelection: vi.fn() }));

	let flowResult: OID4VPFlowResult | undefined;
	await act(async () => {
		flowResult = await result.current.handleCredentialSelection(verifierInfo, dcqlQuery);
	});

	return flowResult!;
}

describe('useOID4VPFlow / no matching credentials', () => {
	beforeEach(() => {
		mocks.transport.transportType = 'websocket';
		mocks.matchCredentials.mockReset();
		mocks.reportNoMatchingCredentials.mockReset();
		mocks.reportNoMatchingCredentials.mockResolvedValue(null);
	});

	it('tells the engine when nothing matches, and reports its error to the user', async () => {
		mocks.matchCredentials.mockReturnValue({
			matches: [],
			code: 'NO_MATCHING_CREDENTIALS',
			no_match_reason: 'No credentials match DCQL query',
		});
		mocks.reportNoMatchingCredentials.mockResolvedValue({
			success: false,
			error: {
				code: 'NO_MATCHING_CREDENTIAL',
				message: 'This request needs a credential you do not have: urn:eudi:pid:1',
				details: { requested_types: ['urn:eudi:pid:1'] },
			},
		});

		const flowResult = await selectCredentials();

		expect(mocks.reportNoMatchingCredentials).toHaveBeenCalledWith('No credentials match DCQL query');
		expect(flowResult).toEqual({
			success: false,
			error: {
				code: 'NO_MATCHING_CREDENTIAL',
				message: 'This request needs a credential you do not have: urn:eudi:pid:1',
				details: { requested_types: ['urn:eudi:pid:1'] },
			},
		});
	});

	it('keeps the local error when the engine has nothing to say', async () => {
		// An engine older than go-wallet-backend #336 ignores credentials_matched.
		mocks.matchCredentials.mockReturnValue({
			matches: [],
			code: 'INSUFFICIENT_CREDENTIALS',
			no_match_reason: 'Not all required credentials are available',
		});

		const flowResult = await selectCredentials();

		expect(mocks.reportNoMatchingCredentials).toHaveBeenCalled();
		expect(flowResult.error).toEqual({
			code: 'INSUFFICIENT_CREDENTIALS',
			message: 'Not all required credentials are available',
		});
	});

	it('does not report to an engine that is not orchestrating the flow', async () => {
		mocks.transport.transportType = 'http_proxy';
		mocks.matchCredentials.mockReturnValue({ matches: [], no_match_reason: 'No credentials match DCQL query' });

		const flowResult = await selectCredentials();

		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
		expect(flowResult.error?.code).toBe('NO_MATCHING_CREDENTIALS');
	});

	it('leaves the consent path alone when credentials do match', async () => {
		mocks.matchCredentials.mockReturnValue({
			matches: [{ input_descriptor_id: 'pid', credential_id: '1', format: 'dc+sd-jwt' }],
		});

		await selectCredentials();

		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
	});
});
