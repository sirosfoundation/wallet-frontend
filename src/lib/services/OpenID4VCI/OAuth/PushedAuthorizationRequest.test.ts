import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateKeyPair, exportJWK } from 'jose';
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

async function generateAttestationKeyPair() {
	// Use crypto.subtle directly (not jose.generateKeyPair) so the private
	// key is guaranteed to be a real CryptoKey, matching what
	// oauth4webapi.DPoP requires - jose can return a Node KeyObject instead
	// depending on runtime detection.
	const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
	const publicKeyJwk = await exportJWK(keyPair.publicKey);
	return { privateKey: keyPair.privateKey, publicKeyJwk };
}

const baseParams = () => ({
	scope: 'siros_id',
	response_type: 'code',
	client_id: 'client-id',
	state: 'state-value',
	redirect_uri: 'https://wallet.example.com/cb',
});

const dpopCapableAsMeta: OpenidAuthorizationServerMetadata = {
	issuer: 'https://as.example.com',
	token_endpoint: 'https://as.example.com/token',
	pushed_authorization_request_endpoint: 'https://as.example.com/par',
	dpop_signing_alg_values_supported: ['ES256'],
};

const noDpopAsMeta: OpenidAuthorizationServerMetadata = {
	issuer: 'https://as.example.com',
	token_endpoint: 'https://as.example.com/token',
	pushed_authorization_request_endpoint: 'https://as.example.com/par',
};

describe('usePushedAuthorizationRequest - wallet attestation', () => {
	beforeEach(() => {
		mockPost.mockReset();
		mockPost.mockResolvedValue(parResponse());
	});

	it('attaches OAuth-Client-Attestation headers to the PAR request when an attestation is provided', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());
		const keyPair = await generateAttestationKeyPair();

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(
				dpopCapableAsMeta,
				baseParams(),
				{ wia: 'signed.wia.jwt', keyPair },
			);
		});

		const [, , headers] = mockPost.mock.calls[0];
		expect(headers['oauth-client-attestation']).toBe('signed.wia.jwt');
		expect(typeof headers['oauth-client-attestation-pop']).toBe('string');
	});

	it('sends no attestation headers when no attestation is provided', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(dpopCapableAsMeta, baseParams());
		});

		const [, , headers] = mockPost.mock.calls[0];
		expect(headers['oauth-client-attestation']).toBeUndefined();
		expect(headers['oauth-client-attestation-pop']).toBeUndefined();
	});

	it('binds the request to the attestation key via a DPoP proof header when the AS supports DPoP', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());
		const keyPair = await generateAttestationKeyPair();

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(
				dpopCapableAsMeta,
				baseParams(),
				{ wia: 'signed.wia.jwt', keyPair },
			);
		});

		// oauth4webapi's DPoP option attaches a fresh DPoP proof JWT directly as
		// a request header (not a dpop_jkt body parameter) for PAR, same as it
		// does for token requests.
		const [, , headers] = mockPost.mock.calls[0];
		expect(typeof headers['dpop']).toBe('string');
	});

	it('does not attach a DPoP header when the AS does not advertise DPoP support, even with an attestation', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());
		const keyPair = await generateAttestationKeyPair();

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(
				noDpopAsMeta,
				baseParams(),
				{ wia: 'signed.wia.jwt', keyPair },
			);
		});

		const [, , headers] = mockPost.mock.calls[0];
		expect(headers['dpop']).toBeUndefined();
	});

	// Regression guard mirroring TokenRequest.test.ts: the hook's refs must
	// not leak an attestation from one call into the next call that passes
	// none - PushedAuthorizationRequest.ts's myCustomFetch reads a ref set by
	// sendPushedAuthorizationRequest, not an argument threaded directly
	// through, so a missed reset would silently reattach a stale WIA.
	it('does not leak a wallet attestation from a previous call into one that provides none', async () => {
		const { result } = renderHook(() => usePushedAuthorizationRequest());
		const keyPair = await generateAttestationKeyPair();

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(
				dpopCapableAsMeta,
				baseParams(),
				{ wia: 'signed.wia.jwt', keyPair },
			);
		});
		expect(mockPost.mock.calls[0][2]['oauth-client-attestation']).toBe('signed.wia.jwt');

		await act(async () => {
			await result.current.sendPushedAuthorizationRequest(dpopCapableAsMeta, baseParams());
		});
		expect(mockPost.mock.calls[1][2]['oauth-client-attestation']).toBeUndefined();
	});
});
