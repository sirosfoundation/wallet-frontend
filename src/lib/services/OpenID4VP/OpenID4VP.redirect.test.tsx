import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import SessionContext, { type SessionContextValue } from '@/context/SessionContext';
import CredentialsContext, { type CredentialsContextValue } from '@/context/CredentialsContext';
import { logger } from '@/logger';
import { useOpenID4VP } from './OpenID4VP';

/**
 * Covers the http_proxy half of issue #159: the verifier's `redirect_uri` from
 * the direct_post response must be logged and dropped, never handed back to
 * the caller for the wallet to navigate to.
 *
 * The websocket half is covered in
 * `src/lib/openid-flow/__tests__/OIDFlowWebSocketTransport.test.ts`, and the
 * shared contract that keeps any other transport from reintroducing it in
 * `src/lib/openid-flow/__tests__/OID4VPFlowResultRedirect.test.ts`.
 */

const { createAuthorizationResponse, post, updatePrivateData, keystoreCommit } = vi.hoisted(() => ({
	createAuthorizationResponse: vi.fn(),
	post: vi.fn(),
	updatePrivateData: vi.fn(async () => { }),
	keystoreCommit: vi.fn(async () => { }),
}));

vi.mock('wallet-common', () => ({
	OpenID4VPServerAPI: class {
		createAuthorizationResponse = createAuthorizationResponse;
	},
	OpenID4VPResponseMode: { DIRECT_POST: 'direct_post' },
	TransactionDataResponse: class { },
	HandleAuthorizationRequestError: { NONE: 'none' },
}));

vi.mock('@/hooks/useHttpClient', () => ({
	useHttpClient: () => ({ post }),
}));

vi.mock('../OpenID4VPRelyingPartyStateRepository', () => ({
	useOpenID4VPRelyingPartyStateRepository: () => ({
		store: async () => { },
		retrieve: async () => ({}),
	}),
}));

vi.mock('../TrustEvaluator', () => ({
	createVerifierTrustEvaluator: () => async () => ({ trusted: true }),
	createDIDResolver: () => async () => null,
}));

vi.mock('./TransactionData/parseTransactionData', () => ({
	parseTransactionDataWithUI: async () => null,
}));

vi.mock('../CredentialBatchHelper', () => ({
	getLeastUsedCredentialInstance: async () => null,
}));

vi.mock('@/lib/tenant', () => ({ getTenantFromUrlPath: () => 'default' }));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/logger', () => ({
	logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
	jsonToLog: (value: unknown) => value,
}));

const RESPONSE_URI = 'https://verifier.example.com/response';

/** Minimal stand-ins — sendAuthorizationResponse only forwards these through. */
const session = {
	api: { updatePrivateData, authTokens: { ensureAnonymousToken: async () => ({ raw: 'tok' }) } },
	keystore: {
		addPresentations: async () => [null, { data: 'private' }, keystoreCommit],
		getCalculatedWalletState: () => ({}),
	},
} as unknown as SessionContextValue;

const credentials = { parseCredential: async () => null } as unknown as CredentialsContextValue;

function renderOpenID4VP() {
	return renderHook(() => useOpenID4VP({ showTransactionDataConsentPopup: async () => true }), {
		wrapper: ({ children }) => (
			<SessionContext.Provider value={session}>
				<CredentialsContext.Provider value={credentials}>{children}</CredentialsContext.Provider>
			</SessionContext.Provider>
		),
	});
}

describe('sendAuthorizationResponse redirect handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAuthorizationResponse.mockResolvedValue({
			formData: new URLSearchParams({ vp_token: 'vp' }),
			generatedVPs: ['vp'],
			filteredVCEntities: [{ credentialId: 'cred-1' }],
			response_uri: RESPONSE_URI,
			client_id: 'x509_san_dns:verifier.example.com',
		});
	});

	it('drops the verifier redirect_uri and logs it instead', async () => {
		post.mockResolvedValue({
			status: 200,
			data: { redirect_uri: 'https://verifier.example.com/callback' },
		});

		const { result } = renderOpenID4VP();
		const sendResult = await result.current.sendAuthorizationResponse(new Map(), []);

		expect(post).toHaveBeenCalledWith(RESPONSE_URI, 'vp_token=vp', expect.anything());
		// Nothing for the caller to navigate to.
		expect(sendResult).toBeUndefined();
		expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
			'Ignoring redirect_uri from direct_post response',
		);
	});

	it('still returns presentation_during_issuance_session', async () => {
		post.mockResolvedValue({
			status: 200,
			data: { presentation_during_issuance_session: 'session-1' },
		});

		const { result } = renderOpenID4VP();
		const sendResult = await result.current.sendAuthorizationResponse(new Map(), []);

		expect(sendResult).toEqual({ presentation_during_issuance_session: 'session-1' });
	});

	it('throws on an error status instead of following anything', async () => {
		post.mockResolvedValue({
			status: 400,
			data: { redirect_uri: 'https://verifier.example.com/callback' },
		});

		const { result } = renderOpenID4VP();
		await expect(result.current.sendAuthorizationResponse(new Map(), [])).rejects.toThrow(
			'Direct post to verifier failed with status 400',
		);
	});
});
