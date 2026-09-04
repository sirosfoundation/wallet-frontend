import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { decodeJwt } from 'jose';

import { useOIDFlowSignHandler, type OIDFlowSignResponse } from './useOIDFlowSignHandler';

const mockPost = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/api')>()),
	useApi: () => ({ post: mockPost }),
}));

vi.mock('@/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/config')>()),
	WIA_ENABLED: true,
	BACKEND_URL: 'https://wallet-provider.example',
}));

vi.mock('@/context/SessionContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ keystore: {} }) };
});

vi.mock('@/context/StatusContext', async () => {
	const { createContext } = await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ isOnline: true }) };
});

function primeWiaResponses() {
	mockPost
		.mockResolvedValueOnce({ data: { challenge: 'test-challenge' } })
		.mockResolvedValueOnce({ data: { wallet_instance_attestation: 'signed.wia.jwt' } });
}

function renderSignHandler() {
	return renderHook(() => useOIDFlowSignHandler());
}

describe('useOIDFlowSignHandler / request_attestation', () => {
	beforeEach(() => {
		mockPost.mockReset();
	});

	it('maps params.issuer -> PoP iss and params.audience -> PoP aud (not the reverse)', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				action: 'request_attestation',
				params: { issuer: 'https://wallet.example.com/cb', audience: 'https://as.example.com' },
			});
		});

		expect(res?.clientAttestation).toBe('signed.wia.jwt');

		const pop = decodeJwt(res!.clientAttestationPoP!);
		expect(pop.iss).toBe('https://wallet.example.com/cb');
		expect(pop.aud).toBe('https://as.example.com');
	});

	it('addresses the WIA-request PoP to the wallet provider (BACKEND_URL), not the AS', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		await act(async () => {
			await result.current.handleSignRequest({
				action: 'request_attestation',
				params: { issuer: 'https://wallet.example.com/cb', audience: 'https://as.example.com' },
			});
		});

		expect(mockPost).toHaveBeenNthCalledWith(1, '/wallet-provider/wia/challenge', {});

		const [path, body] = mockPost.mock.calls[1];
		expect(path).toBe('/wallet-provider/wia/generate');
		expect(body.client_id).toBe('https://wallet.example.com/cb');

		const reqPop = decodeJwt(body.pop);
		expect(reqPop.aud).toBe('https://wallet-provider.example');
	});

	it('degrades to {} without calling the backend when issuer or audience is missing', async () => {
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				action: 'request_attestation',
				params: { issuer: 'https://wallet.example.com/cb' },
			});
		});

		expect(res).toEqual({});
		expect(mockPost).not.toHaveBeenCalled();
	});
});
