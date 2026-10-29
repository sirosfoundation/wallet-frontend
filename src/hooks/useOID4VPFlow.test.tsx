import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useOID4VPFlow, type OID4VPErrorActions } from './useOID4VPFlow';
import type { OID4VPFlowResult } from '@/lib/openid-flow/types/OID4VPTypes';
import type { DCAPIRequest } from '@/lib/openid-flow/platforms/dc-api';
import { OIDFlowError } from '@/lib/openid-flow/errors';
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
		trustEvaluators: { evaluateVerifierTrust: async () => ({ trusted: true, name: 'Test Verifier' }) },
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

const noMatch = {
	matches: [],
	code: 'NO_MATCHING_CREDENTIALS',
	no_match_reason: 'No credentials match DCQL query',
	missing_types: ['urn:eudi:pid:1'],
};

const engineNoMatch = {
	success: false,
	error: {
		code: 'NO_MATCHING_CREDENTIALS',
		message: 'You do not have a credential that matches this request',
		details: { redirect_uri: 'https://verifier.example.com/cb#error=access_denied' },
	},
};

function renderFlow() {
	const onError = vi.fn<(error: Error, actions?: OID4VPErrorActions) => void>();
	const { result } = renderHook(() => useOID4VPFlow({
		onError,
		onCredentialSelection: vi.fn().mockResolvedValue(new Map()),
	}));
	return { result, onError };
}

/**
 * Run a credential selection the way the presentation page does, with the
 * state updates the hook makes along the way wrapped in act().
 */
async function selectCredentials() {
	const { result, onError } = renderFlow();

	let flowResult: OID4VPFlowResult | undefined;
	await act(async () => {
		flowResult = await result.current.handleCredentialSelection(verifierInfo, dcqlQuery);
	});

	return { flowResult: flowResult!, onError, actions: onError.mock.calls[0]?.[1] };
}

describe('useOID4VPFlow / no matching credentials', () => {
	beforeEach(() => {
		mocks.transport.transportType = 'websocket';
		mocks.matchCredentials.mockReset();
		mocks.reportNoMatchingCredentials.mockReset();
		mocks.reportNoMatchingCredentials.mockResolvedValue(null);
	});

	it('fails with the local error and names the missing types, without contacting the engine', async () => {
		mocks.matchCredentials.mockReturnValue(noMatch);

		const { flowResult, onError } = await selectCredentials();

		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
		expect(flowResult).toEqual({
			success: false,
			error: {
				code: 'NO_MATCHING_CREDENTIALS',
				message: 'No credentials match DCQL query',
				details: { missing_types: ['urn:eudi:pid:1'] },
			},
		});
		expect(onError).toHaveBeenCalledWith(expect.any(OIDFlowError), expect.objectContaining({
			reportNoMatchingCredentials: expect.any(Function),
		}));
	});

	it('reports once when asked, and returns the verifier redirect from the engine', async () => {
		mocks.matchCredentials.mockReturnValue(noMatch);
		mocks.reportNoMatchingCredentials.mockResolvedValue(engineNoMatch);

		const { actions } = await selectCredentials();

		expect(await actions!.reportNoMatchingCredentials()).toBe('https://verifier.example.com/cb#error=access_denied');
		expect(await actions!.reportNoMatchingCredentials()).toBeUndefined();
		expect(mocks.reportNoMatchingCredentials).toHaveBeenCalledTimes(1);
	});

	it('ignores an engine answer with any other code', async () => {
		mocks.matchCredentials.mockReturnValue(noMatch);
		mocks.reportNoMatchingCredentials.mockResolvedValue({
			success: false,
			error: { code: 'UNKNOWN_FLOW', message: 'Flow not found', details: { redirect_uri: 'https://evil.example.com' } },
		});

		const { actions } = await selectCredentials();

		expect(await actions!.reportNoMatchingCredentials()).toBeUndefined();
	});

	it('returns no redirect when the engine does not answer', async () => {
		mocks.matchCredentials.mockReturnValue(noMatch);

		const { actions } = await selectCredentials();

		expect(await actions!.reportNoMatchingCredentials()).toBeUndefined();
		expect(mocks.reportNoMatchingCredentials).toHaveBeenCalledTimes(1);
	});

	it('does not report to an engine that is not orchestrating the flow', async () => {
		mocks.transport.transportType = 'http_proxy';
		mocks.matchCredentials.mockReturnValue(noMatch);

		const { actions } = await selectCredentials();

		expect(await actions!.reportNoMatchingCredentials()).toBeUndefined();
		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
	});

	it('does not report for errors other than a no-match', async () => {
		mocks.matchCredentials.mockImplementation(() => {
			throw new Error('wallet state unavailable');
		});

		const { flowResult, actions } = await selectCredentials();

		expect(flowResult.error?.code).toBe('SELECTION_ERROR');
		expect(await actions!.reportNoMatchingCredentials()).toBeUndefined();
		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
	});

	it('does not report a DC API no-match to the engine', async () => {
		mocks.matchCredentials.mockReturnValue(noMatch);
		const { result, onError } = renderFlow();

		let flowResult: OID4VPFlowResult | undefined;
		await act(async () => {
			flowResult = await result.current.handleDCAPIRequest(
				{ isSigned: false, dcqlQuery } as unknown as DCAPIRequest,
				[],
				'https://verifier.example.com',
			);
		});

		expect(flowResult!.error?.details).toEqual({ missing_types: ['urn:eudi:pid:1'] });
		expect(await onError.mock.calls[0][1]!.reportNoMatchingCredentials()).toBeUndefined();
		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
	});

	it('leaves the consent path alone when credentials do match', async () => {
		mocks.matchCredentials.mockReturnValue({
			matches: [{ input_descriptor_id: 'pid', credential_id: '1', format: 'dc+sd-jwt' }],
		});

		const { flowResult, onError } = await selectCredentials();

		expect(flowResult.success).toBe(true);
		expect(onError).not.toHaveBeenCalled();
		expect(mocks.reportNoMatchingCredentials).not.toHaveBeenCalled();
	});
});
