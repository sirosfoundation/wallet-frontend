import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OpenidAuthorizationServerMetadata } from 'wallet-common';
import { usePushedAuthorizationRequest } from './PushedAuthorizationRequest';

const mockPost = vi.fn();

vi.mock('@/hooks/useHttpClient', () => ({
	useHttpClient: () => ({ post: mockPost }),
}));

function parResponse() {
	return {
		status: 201,
		headers: { 'content-type': 'application/json' },
		data: { request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 60 },
	};
}

const baseParams = () => ({
	scope: 'siros_id',
	response_type: 'code',
	client_id: 'client-id',
	state: 'state-value',
	redirect_uri: 'https://wallet.example.com/cb',
});

const asMeta: OpenidAuthorizationServerMetadata = {
	issuer: 'https://as.example.com',
	token_endpoint: 'https://as.example.com/token',
	pushed_authorization_request_endpoint: 'https://as.example.com/par',
};

describe('usePushedAuthorizationRequest', () => {
	beforeEach(() => {
		mockPost.mockReset();
		mockPost.mockResolvedValue(parResponse());
	});

	it('sends a PAR request and returns the request_uri and code_verifier', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());

		let response: { request_uri: string; code_verifier: string } | undefined;
		await act(async () => {
			response = await result.current.sendPushedAuthorizationRequest(asMeta, baseParams());
		});

		expect(response?.request_uri).toBe('urn:ietf:params:oauth:request_uri:abc');
		expect(typeof response?.code_verifier).toBe('string');

		const [url, , headers] = mockPost.mock.calls[0];
		expect(url).toBe(asMeta.pushed_authorization_request_endpoint);
		// No wallet attestation mechanism on this path (removed - see the
		// transport-agnostic implementation in useOID4VCIFlow.ts/WIA.ts instead).
		expect(headers['oauth-client-attestation']).toBeUndefined();
	});

	it('throws when the AS metadata is missing a pushed_authorization_request_endpoint', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());
		const incompleteAsMeta: OpenidAuthorizationServerMetadata = {
			issuer: 'https://as.example.com',
			token_endpoint: 'https://as.example.com/token',
		};

		await expect(
			result.current.sendPushedAuthorizationRequest(incompleteAsMeta, baseParams())
		).rejects.toThrow('pushed_authorization_request_endpoint');
	});
});
