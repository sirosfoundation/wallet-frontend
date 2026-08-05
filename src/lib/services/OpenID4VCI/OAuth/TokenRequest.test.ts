import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { exportJWK } from 'jose';
import { useTokenRequest, GrantType } from './TokenRequest';

const mockPost = vi.fn();

vi.mock('@/hooks/useHttpClient', () => ({
	useHttpClient: () => ({ post: mockPost }),
}));

function tokenResponse() {
	return {
		status: 200,
		headers: { 'content-type': 'application/json' },
		data: { access_token: 'at', token_type: 'bearer', c_nonce: 'cn', expires_in: 60, c_nonce_expires_in: 60 },
	};
}

async function setUpBasicPreAuthorizedRequest(result: ReturnType<typeof renderHook<ReturnType<typeof useTokenRequest>, unknown>>['result']) {
	// Use crypto.subtle directly (not jose.generateKeyPair) so the private
	// key is guaranteed to be a real CryptoKey, matching what
	// oauth4webapi.DPoP requires — jose can return a Node KeyObject instead
	// depending on runtime detection.
	const dpopKeyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
	const dpopPublicKeyJwk = await exportJWK(dpopKeyPair.publicKey);

	act(() => {
		result.current.setTokenEndpoint('https://issuer.example.com/token');
		result.current.setIssuer('https://issuer.example.com');
		result.current.setClientId('client-id');
		result.current.setGrantType(GrantType.PRE_AUTHORIZED_CODE);
		result.current.setPreAuthorizedCode('pre-auth-code');
		result.current.setDpopHeader(dpopKeyPair.privateKey as any, dpopPublicKeyJwk, 'jti');
	});
}

describe('useTokenRequest', () => {
	beforeEach(() => {
		mockPost.mockReset();
	});

	it('sends a pre-authorized_code token request and returns the access token', async () => {
		mockPost.mockResolvedValue(tokenResponse());
		const { result } = renderHook(() => useTokenRequest());
		await setUpBasicPreAuthorizedRequest(result);

		let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
		await act(async () => {
			outcome = await result.current.execute();
		});

		expect(outcome && 'response' in outcome && outcome.response.access_token).toBe('at');
		// No wallet attestation mechanism on this path (removed - see the
		// transport-agnostic implementation in useOID4VCIFlow.ts/WIA.ts instead).
		const [, , headers] = mockPost.mock.calls[0];
		expect(headers['oauth-client-attestation']).toBeUndefined();
	});
});
