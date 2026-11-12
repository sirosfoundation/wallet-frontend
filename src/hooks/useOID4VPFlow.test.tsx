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
	/** The in-browser engine's DC API entry points, present when enabled. */
	engine: { enabled: false, startDCAPIPresentation: vi.fn(), startOID4VPFlow: vi.fn() },
	session: {
		keystore: { addPresentations: vi.fn(async (_presentations: Array<{ audience: string }>) => [null, { pd: 1 }, async () => {}]) },
		api: { updatePrivateData: vi.fn(async () => {}) },
	},
}));

vi.mock('@/lib/services/CredentialMatchingService', () => ({
	matchCredentials: mocks.matchCredentials,
}));

vi.mock('@/context/OIDFlowTransportContext', () => ({
	useOIDFlowTransportSafe: () => ({
		transportType: mocks.transport.transportType,
		transport: {
			reportNoMatchingCredentials: mocks.reportNoMatchingCredentials,
			...(mocks.engine.enabled ? {
				startDCAPIPresentation: mocks.engine.startDCAPIPresentation,
				startOID4VPFlow: mocks.engine.startOID4VPFlow,
			} : {}),
		},
		trustEvaluators: { evaluateVerifierTrust: async () => ({ trusted: true, name: 'Test Verifier' }) },
	}),
}));

vi.mock('@/context/SessionContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext(mocks.session) };
});

vi.mock('@/context/CredentialsContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ vcEntityList: [] }) };
});

vi.mock('@/lib/verifiable-credentials', () => ({
	applySelectiveDisclosure: async (raw: string) => raw,
}));

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
		mocks.engine.enabled = false;
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

describe('useOID4VPFlow / DC API on the in-browser engine', () => {
	const ORIGIN = 'https://verifier.example.com';
	const request = { engineParams: () => ({ nonce: 'n-1', dcql_query: dcqlQuery, response_mode: 'dc_api' }) } as unknown as DCAPIRequest;
	const selected = [{
		batchId: 1, credentialQueryId: 'pid', walletCredentialRef: '7', credentialRaw: 'eyJ.cred~', holderKeyKid: 'k', disclosedClaims: ['age'],
	}];
	const session = () => ({ verifiedOrigin: ORIGIN, sendEngineResponse: vi.fn(), sendErrorAndClose: vi.fn() });

	beforeEach(() => {
		mocks.transport.transportType = 'websocket';
		mocks.engine.enabled = true;
		mocks.engine.startDCAPIPresentation.mockReset();
		mocks.engine.startOID4VPFlow.mockReset();
		mocks.matchCredentials.mockReset();
		mocks.reportNoMatchingCredentials.mockReset().mockResolvedValue(null);
		mocks.session.keystore.addPresentations.mockClear();
	});

	it('hands the request and the verified origin to the engine, then matches locally', async () => {
		mocks.engine.startDCAPIPresentation.mockResolvedValue({ success: true, dcqlQuery, verifierInfo });
		mocks.matchCredentials.mockReturnValue({ matches: [{ input_descriptor_id: 'pid', credential_id: '1', format: 'dc+sd-jwt' }] });
		const { result } = renderFlow();

		let flowResult: OID4VPFlowResult | undefined;
		await act(async () => {
			flowResult = await result.current.handleDCAPIRequest(request, [], ORIGIN);
		});

		expect(mocks.engine.startDCAPIPresentation).toHaveBeenCalledWith({
			request: { nonce: 'n-1', dcql_query: dcqlQuery, response_mode: 'dc_api' },
			origin: ORIGIN,
		});
		expect(flowResult).toMatchObject({ success: true, verifierInfo });
		expect(flowResult!.conformantCredentials).toBeDefined();
	});

	it('ends the engine flow when nothing matches', async () => {
		mocks.engine.startDCAPIPresentation.mockResolvedValue({ success: true, dcqlQuery, verifierInfo });
		mocks.matchCredentials.mockReturnValue(noMatch);
		const { result } = renderFlow();

		let flowResult: OID4VPFlowResult | undefined;
		await act(async () => {
			flowResult = await result.current.handleDCAPIRequest(request, [], ORIGIN);
		});

		expect(flowResult!.success).toBe(false);
		expect(mocks.reportNoMatchingCredentials).toHaveBeenCalledTimes(1);
	});

	it('reports the engine\'s refusal (e.g. an untrusted verifier)', async () => {
		mocks.engine.startDCAPIPresentation.mockResolvedValue({ success: false, error: { code: 'UNTRUSTED_VERIFIER', message: 'no' } });
		const { result } = renderFlow();

		let flowResult: OID4VPFlowResult | undefined;
		await act(async () => {
			flowResult = await result.current.handleDCAPIRequest(request, [], ORIGIN);
		});

		expect(flowResult!.error?.code).toBe('UNTRUSTED_VERIFIER');
		expect(mocks.matchCredentials).not.toHaveBeenCalled();
	});

	it('returns the response the engine built through the DC API channel, and records the presentation', async () => {
		const dcApiResponse = { vp_token: { pid: ['t'] } };
		mocks.engine.startOID4VPFlow.mockResolvedValue({ success: true, dcApiResponse });
		const s = session();
		const { result } = renderFlow();

		let sent: OID4VPFlowResult | undefined;
		await act(async () => {
			sent = await result.current.sendDCAPIResponse(s as any, selected);
		});

		expect(sent).toEqual({ success: true });
		expect(mocks.engine.startOID4VPFlow).toHaveBeenCalledWith({ selectedCredentials: selected });
		expect(s.sendEngineResponse).toHaveBeenCalledWith(dcApiResponse);
		expect(mocks.session.keystore.addPresentations).toHaveBeenCalledTimes(1);
		expect(mocks.session.keystore.addPresentations.mock.calls[0]?.[0][0]).toMatchObject({ audience: `origin:${ORIGIN}` });
	});

	it('returns the engine\'s error response, or access_denied when it built none', async () => {
		const refusal = { error: 'access_denied', error_description: 'The wallet did not fulfil the request' };
		mocks.engine.startOID4VPFlow.mockResolvedValueOnce({ success: false, error: { code: 'PRESENTATION_DECLINED', message: 'x' }, dcApiResponse: refusal });
		const first = session();
		const { result } = renderFlow();
		let sent: OID4VPFlowResult | undefined;
		await act(async () => {
			sent = await result.current.sendDCAPIResponse(first as any, selected);
		});
		expect(sent!.success).toBe(false);
		expect(first.sendEngineResponse).toHaveBeenCalledWith(refusal);
		expect(mocks.session.keystore.addPresentations).not.toHaveBeenCalled();

		mocks.engine.startOID4VPFlow.mockResolvedValueOnce({ success: false, error: { code: 'TIMEOUT', message: 'x' } });
		const second = session();
		await act(async () => {
			await result.current.sendDCAPIResponse(second as any, selected);
		});
		expect(second.sendErrorAndClose).toHaveBeenCalledWith('access_denied');
	});
});