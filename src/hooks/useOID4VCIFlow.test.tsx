import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import CredentialsContext, {
	type CredentialsContextValue,
} from '@/context/CredentialsContext';
import SessionContext, {
	type SessionContextValue,
} from '@/context/SessionContext';
import type { OID4VCIFlowResult } from '@/lib/openid-flow/types/OID4VCITypes';
import useOID4VCIFlow from './useOID4VCIFlow';

const { transport } = vi.hoisted(() => ({
	transport: {
		releaseFlow: vi.fn(),
		startOID4VCIFlow: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	},
}));

vi.mock('@/context/OIDFlowTransportContext', () => ({
	useOIDFlowTransportSafe: () => ({ transport, transportType: 'websocket' }),
}));

// The credentials context has no default value: the hook needs a provider (only the engine is read here).
const credentials = {
	credentialEngine: new Promise(() => undefined),
} as unknown as CredentialsContextValue;
const session = {
	oidFlowClientAuthMaterialManager: {
		exportAuthMaterial: vi.fn().mockResolvedValue(undefined),
		seedMaterial: vi.fn(),
	},
} as unknown as SessionContextValue;
const wrapper = ({ children }: { children: ReactNode }) => (
	<SessionContext.Provider value={session}>
		<CredentialsContext.Provider value={credentials}>
			{children}
		</CredentialsContext.Provider>
	</SessionContext.Provider>
);

const OFFER_URL = new URL(
	'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer',
);
const OFFER = {
	credential_issuer: 'https://issuer.example.com',
	credential_configuration_ids: ['pid'],
};
const AUTHORIZATION_RESULT: OID4VCIFlowResult = {
	success: true,
	authorizationUrl: 'https://as.example.com/authorize?request_uri=urn:x',
	codeVerifier: 'saved-verifier',
	issuerState: 'saved-state',
	authorizationContext: 'signed.authorization.context',
	credentialOffer: OFFER,
};
const CONTEXT_LIFETIME_MS = 5 * 60 * 1000;

describe('useOID4VCIFlow: aborting a flow reaches the transport', () => {
	it('releases what the transport holds for the flow when the hook unmounts', () => {
		transport.releaseFlow.mockClear();
		const { unmount } = renderHook(() => useOID4VCIFlow(), { wrapper });
		expect(transport.releaseFlow).not.toHaveBeenCalled();

		unmount();

		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('does not release a second time when the aborted flow’s request then fails (it could hit a newer flow)', async () => {
		transport.releaseFlow.mockClear();
		let failStart!: (reason: Error) => void;
		transport.startOID4VCIFlow.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					failStart = reject;
				}),
		);
		const { result, unmount } = renderHook(() => useOID4VCIFlow(), { wrapper });
		const outcome = result.current.handleCredentialOffer(
			new URL(
				'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer',
			),
		);
		await vi.waitFor(() => expect(failStart).toBeTypeOf('function'));

		unmount();
		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
		failStart(new Error('The flow was released locally'));
		const settled = await outcome;

		expect(settled.error?.code).toBe('ABORTED');
		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('releases it when starting the flow fails locally', async () => {
		transport.releaseFlow.mockClear();
		transport.startOID4VCIFlow.mockRejectedValue(new Error('boom'));
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleCredentialOffer(
			new URL(
				'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer',
			),
		);

		expect(outcome.success).toBe(false);
		expect(transport.releaseFlow).toHaveBeenCalled();
	});
});

describe('useOID4VCIFlow: resuming after a same-tab redirect', () => {
	beforeEach(() => {
		sessionStorage.clear();
		transport.startOID4VCIFlow.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('sends the saved context and verifier with the callback state and iss after a remount', async () => {
		await saveAuthorizationResult(AUTHORIZATION_RESULT);
		transport.startOID4VCIFlow.mockResolvedValueOnce({ success: true });
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleAuthorizationResponse(
			'auth-code',
			'saved-state',
			'https://as.example.com',
		);

		expect(outcome.success).toBe(true);
		expect(transport.startOID4VCIFlow).toHaveBeenLastCalledWith(
			expect.objectContaining({
				credentialOffer: JSON.stringify(OFFER),
				authorizationCode: 'auth-code',
				codeVerifier: 'saved-verifier',
				state: 'saved-state',
				authorizationResponseIssuer: 'https://as.example.com',
				authorizationContext: 'signed.authorization.context',
			}),
		);
	});

	it('saves and sends the context when the authorization result has no verifier', async () => {
		await saveAuthorizationResult({
			...AUTHORIZATION_RESULT,
			codeVerifier: undefined,
		});
		transport.startOID4VCIFlow.mockResolvedValueOnce({ success: true });
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleAuthorizationResponse(
			'auth-code',
			'saved-state',
			undefined,
		);

		expect(outcome.success).toBe(true);
		const [params] = transport.startOID4VCIFlow.mock.lastCall!;
		expect(params.authorizationContext).toBe('signed.authorization.context');
		expect(params.state).toBe('saved-state');
		expect(params.codeVerifier).toBeUndefined();
		expect(params.authorizationResponseIssuer).toBeUndefined();
	});

	it('still resumes at exactly five minutes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		await saveAuthorizationResult(AUTHORIZATION_RESULT);
		vi.setSystemTime(Date.now() + CONTEXT_LIFETIME_MS);
		transport.startOID4VCIFlow.mockResolvedValueOnce({ success: true });
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleAuthorizationResponse(
			'auth-code',
			'saved-state',
			'https://as.example.com',
		);

		expect(outcome.success).toBe(true);
		expect(transport.startOID4VCIFlow).toHaveBeenCalledTimes(2);
	});

	it('drops the saved flow once five minutes have passed and never resumes it', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		await saveAuthorizationResult(AUTHORIZATION_RESULT);
		vi.setSystemTime(Date.now() + CONTEXT_LIFETIME_MS + 1);
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleAuthorizationResponse(
			'auth-code',
			'saved-state',
			'https://as.example.com',
		);

		expect(outcome.success).toBe(false);
		expect(transport.startOID4VCIFlow).toHaveBeenCalledTimes(1);
		expect(sessionStorage.length).toBe(0);
	});
});

/**
 * Runs a credential offer that ends in an authorization redirect, then unmounts the hook like the page leaving.
 */
async function saveAuthorizationResult(
	authorizationResult: OID4VCIFlowResult,
): Promise<void> {
	transport.startOID4VCIFlow.mockResolvedValueOnce(authorizationResult);
	const { result, unmount } = renderHook(() => useOID4VCIFlow(), { wrapper });

	const outcome = await result.current.handleCredentialOffer(OFFER_URL);

	expect(outcome.authorizationUrl).toBe(authorizationResult.authorizationUrl);
	unmount();
}
