import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateKeyPair, exportJWK } from 'jose';
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

describe('useTokenRequest - wallet attestation header lifecycle', () => {
	beforeEach(() => {
		mockPost.mockReset();
	});

	// Regression test for a review finding: tokenRequestBuilder is one
	// long-lived hook instance reused across every OID4VCI flow in the
	// session. If a flow that sets a wallet attestation is followed by a
	// flow that never calls setWalletAttestation at all (e.g. because that
	// issuer doesn't support DPoP), the second flow's token request must
	// NOT still carry the first flow's stale WIA/PoP.
	it('does not leak a wallet attestation from a previous call once explicitly cleared', async () => {
		mockPost.mockResolvedValue(tokenResponse());
		const { result } = renderHook(() => useTokenRequest());
		await setUpBasicPreAuthorizedRequest(result);

		const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
		const publicKeyJwk = await exportJWK(publicKey);
		act(() => {
			result.current.setWalletAttestation('signed.wia.jwt', { privateKey, publicKeyJwk });
		});

		await act(async () => {
			await result.current.execute();
		});
		const [, , firstHeaders] = mockPost.mock.calls[0];
		expect(firstHeaders['oauth-client-attestation']).toBe('signed.wia.jwt');

		// Simulate the next flow: clear without ever calling
		// setWalletAttestation(wia, keyPair) again — matching what
		// OpenID4VCI.ts does unconditionally at the top of each flow.
		act(() => {
			result.current.setWalletAttestation(undefined);
		});

		await act(async () => {
			await result.current.execute();
		});
		const [, , secondHeaders] = mockPost.mock.calls[1];
		expect(secondHeaders['oauth-client-attestation']).toBeUndefined();
		expect(secondHeaders['oauth-client-attestation-pop']).toBeUndefined();
	});

	it('setWalletAttestation(undefined) does not throw without a keyPair argument', async () => {
		const { result } = renderHook(() => useTokenRequest());

		expect(() => {
			act(() => {
				result.current.setWalletAttestation(undefined);
			});
		}).not.toThrow();
	});
});
