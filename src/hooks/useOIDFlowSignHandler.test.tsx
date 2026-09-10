import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { decodeJwt, decodeProtectedHeader } from 'jose';

import {
	useOIDFlowSignHandler,
	type OIDFlowSignResponse,
} from './useOIDFlowSignHandler';

const mockPost = vi.fn();

vi.mock('@/api', async importOriginal => ({
	...(await importOriginal<typeof import('@/api')>()),
	useApi: () => ({ post: mockPost }),
}));

vi.mock('@/config', async importOriginal => ({
	...(await importOriginal<typeof import('@/config')>()),
	WIA_ENABLED: true,
	BACKEND_URL: 'https://wallet-provider.example',
}));

vi.mock('./useHttpClient', () => ({
	useHttpClient: () => ({ post: mockPost }),
}));

vi.mock('@/context/SessionContext', async () => {
	const { createContext } =
		await vi.importActual<typeof import('react')>('react');
	const { generateKeyPair, exportJWK } =
		await vi.importActual<typeof import('jose')>('jose');
	const { generateRandomIdentifier } = await vi.importActual<
		typeof import('@/lib/utils/generateRandomIdentifier')
	>('@/lib/utils/generateRandomIdentifier');

	// Module-scoped store; each test uses a unique flowId (see note below).
	const store = new Map<
		string,
		{ dpopKeyId: string; keyPair: unknown; wia?: string }
	>();
	const oidFlowClientAuthMaterialManager = {
		async getAuthMaterial(flowId: string) {
			const existing = store.get(flowId);
			if (existing) return existing;
			const { privateKey, publicKey } = await generateKeyPair('ES256', {
				extractable: true,
			});
			const material = {
				dpopKeyId: generateRandomIdentifier(16),
				keyPair: { privateKey, publicKeyJwk: await exportJWK(publicKey) },
			};
			store.set(flowId, material);
			return material;
		},
		attachWia(flowId: string, wia: string) {
			const existing = store.get(flowId);
			if (existing) existing.wia = wia;
		},
	};

	return {
		default: createContext({ keystore: {}, oidFlowClientAuthMaterialManager }),
	};
});

vi.mock('@/context/StatusContext', async () => {
	const { createContext } =
		await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ isOnline: true }) };
});

function primeWiaResponses() {
	mockPost
		.mockResolvedValueOnce({ data: { challenge: 'test-challenge' } })
		.mockResolvedValueOnce({
			data: { wallet_instance_attestation: 'signed.wia.jwt' },
		});
}

function renderSignHandler() {
	return renderHook(() => useOIDFlowSignHandler());
}

describe('useOIDFlowSignHandler / sign_client_auth', () => {
	beforeEach(() => {
		mockPost.mockReset();
	});

	// The per-flow key store is module-scoped and never cleared between tests,
	// so every test uses its own flowId to avoid reusing a prior test's cached
	// key + WIA.

	it('returns a client-held DPoP proof + WIA + fresh attestation PoP when enabled', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-full',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeTruthy();
		expect(res?.clientAttestation).toBe('signed.wia.jwt');
		expect(res?.clientAttestationPoP).toBeTruthy();

		// per-flow attestation PoP: iss = client_id, aud = the AS.
		const pop = decodeJwt(res!.clientAttestationPoP!);
		expect(pop.iss).toBe('https://wallet.example.com/cb');
		expect(pop.aud).toBe('https://as.example.com');
	});

	it('binds the WIA cnf key to the DPoP proof key (cnf == DPoP key, gap 1a)', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-1a',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		// The key that signs the DPoP proof...
		const dpopJwk = decodeProtectedHeader(res!.dpopProof!).jwk;
		// ...must be the same key the WIA was bound to (the WIA-request PoP,
		// posted to /wallet-provider/wia/generate, carries that key in its jwk
		// header).
		const [, generateBody] = mockPost.mock.calls[1];
		const wiaRequestJwk = decodeProtectedHeader(generateBody.pop).jwk;
		expect(dpopJwk).toEqual(wiaRequestJwk);
	});

	it('reuses the flow WIA but mints a fresh DPoP proof + PoP per request (gap 1b)', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		const req = {
			flowId: 'flow-1b',
			action: 'sign_client_auth' as const,
			params: {
				issuer: 'https://wallet.example.com/cb',
				audience: 'https://as.example.com',
				htm: 'POST',
				htu: 'https://as.example.com/token',
			},
		};

		let first: OIDFlowSignResponse | undefined;
		let second: OIDFlowSignResponse | undefined;
		await act(async () => {
			first = await result.current.handleSignRequest(req);
			second = await result.current.handleSignRequest(req);
		});

		// Same flow key + WIA reused (only one challenge/generate round-trip)...
		expect(first?.dpopKeyId).toBe(second?.dpopKeyId);
		expect(first?.clientAttestation).toBe(second?.clientAttestation);
		expect(mockPost).toHaveBeenCalledTimes(2);

		// ...but every proof and PoP is freshly signed (distinct jti).
		expect(decodeJwt(first!.dpopProof!).jti).not.toBe(
			decodeJwt(second!.dpopProof!).jti,
		);
		expect(decodeJwt(first!.clientAttestationPoP!).jti).not.toBe(
			decodeJwt(second!.clientAttestationPoP!).jti,
		);
	});

	it('addresses the WIA-request PoP to the wallet provider (BACKEND_URL), not the AS', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		await act(async () => {
			await result.current.handleSignRequest({
				flowId: 'flow-wia-aud',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(mockPost).toHaveBeenNthCalledWith(
			1,
			'/wallet-provider/wia/challenge',
			{},
		);
		const [path, body] = mockPost.mock.calls[1];
		expect(path).toBe('/wallet-provider/wia/generate');
		expect(decodeJwt(body.pop).aud).toBe('https://wallet-provider.example');
	});

	it('carries ath and dpop_nonce in the DPoP proof when the engine supplies them', async () => {
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-ath',
				action: 'sign_client_auth',
				// resource request: DPoP proof only (no audience), with ath + nonce.
				params: {
					htm: 'GET',
					htu: 'https://issuer.example.com/credential',
					ath: 'access-token-hash',
					dpopNonce: 'server-nonce',
				},
			});
		});

		const proof = decodeJwt(res!.dpopProof!);
		expect(proof.htm).toBe('GET');
		expect(proof.ath).toBe('access-token-hash');
		expect(proof.nonce).toBe('server-nonce');
		expect(res?.clientAttestation).toBeUndefined();
		expect(mockPost).not.toHaveBeenCalled();
	});

	it('returns a WIA but no DPoP proof when the engine asks for attestation only', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-wia-only',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeUndefined();
		expect(res?.clientAttestation).toBe('signed.wia.jwt');
	});

	it('still returns the DPoP proof (no attestation) when the WIA request fails', async () => {
		// challenge resolves without a challenge -> requestWIA returns undefined.
		mockPost.mockResolvedValueOnce({ data: {} });
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-degrade',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeTruthy();
		expect(res?.clientAttestation).toBeUndefined();
		expect(res?.clientAttestationPoP).toBeUndefined();
	});

	it('uses a distinct client-held key per flow', async () => {
		const { result } = renderSignHandler();

		let a: OIDFlowSignResponse | undefined;
		let b: OIDFlowSignResponse | undefined;
		await act(async () => {
			a = await result.current.handleSignRequest({
				flowId: 'flow-a',
				action: 'sign_client_auth',
				params: { htm: 'POST', htu: 'https://as.example.com/token' },
			});
			b = await result.current.handleSignRequest({
				flowId: 'flow-b',
				action: 'sign_client_auth',
				params: { htm: 'POST', htu: 'https://as.example.com/token' },
			});
		});

		expect(a?.dpopKeyId).not.toBe(b?.dpopKeyId);
		expect(decodeProtectedHeader(a!.dpopProof!).jwk).not.toEqual(
			decodeProtectedHeader(b!.dpopProof!).jwk,
		);
	});
});
