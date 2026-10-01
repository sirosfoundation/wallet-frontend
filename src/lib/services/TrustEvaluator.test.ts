import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as walletCommon from 'wallet-common';
import { createTrustEvaluators, createVerifierTrustEvaluator } from './TrustEvaluator';

describe('createVerifierTrustEvaluator', () => {
	const evaluateVerifier = vi.fn();

	beforeEach(() => {
		evaluateVerifier.mockReset();
		vi.spyOn(walletCommon, 'AuthZENClient').mockReturnValue({
			evaluateVerifier,
		} as ReturnType<typeof walletCommon.AuthZENClient>);
	});

	it('passes clientIdScheme.identifier to evaluateVerifier', async () => {
		evaluateVerifier.mockResolvedValue({
			ok: true,
			value: {
				status: walletCommon.TrustStatus.TRUSTED,
				metadata: {},
			},
		});

		const evaluateTrust = createVerifierTrustEvaluator({
			httpClient: vi.fn() as unknown as walletCommon.HttpClient,
			backendUrl: 'https://wallet-backend.example.com',
			getAuthToken: () => 'token',
			tenantId: 'default',
		});

		await evaluateTrust({
			clientIdScheme: {
				scheme: 'did',
				clientId: 'decentralized_identifier:did:web:verifier.example.com',
				identifier: 'did:web:verifier.example.com',
			},
			keyMaterial: {
				type: 'jwk',
				key: { kty: 'EC' },
			},
		});

		expect(evaluateVerifier).toHaveBeenCalledWith({
			clientId: 'did:web:verifier.example.com',
			keyMaterial: {
				type: 'jwk',
				key: { kty: 'EC' },
			},
			context: {},
		});
	});
});

describe('createTrustEvaluators', () => {
	beforeEach(() => {
		vi.spyOn(walletCommon, 'AuthZENClient').mockReturnValue({
			evaluateVerifier: vi.fn(),
			evaluateIssuer: vi.fn(),
			resolve: vi.fn(),
		} as unknown as ReturnType<typeof walletCommon.AuthZENClient>);
	});

	const config = {
		httpClient: { get: vi.fn(), post: vi.fn() } as unknown as walletCommon.HttpClient,
		backendUrl: 'https://wallet-backend.example.com',
		getAuthToken: () => 'token',
		tenantId: 'default',
	};

	it('builds all three evaluators from one config', () => {
		const evaluators = createTrustEvaluators(config);

		expect(typeof evaluators.evaluateIssuerTrust).toBe('function');
		expect(typeof evaluators.evaluateVerifierTrust).toBe('function');
		// The entitlement checker is the one a transport can omit, so its
		// absence here would be silent: the wallet would simply never check
		// whether an issuer is registered for what it offers.
		expect(typeof evaluators.checkIssuerEntitlement).toBe('function');
	});

	it('gives the entitlement checker the backend it was configured with', async () => {
		const post = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: {} });
		const evaluators = createTrustEvaluators({
			...config,
			httpClient: { get: vi.fn(), post } as unknown as walletCommon.HttpClient,
		});

		await evaluators.checkIssuerEntitlement({ issuerId: 'https://issuer.example.com' });

		expect(post).toHaveBeenCalledTimes(1);
		expect(post.mock.calls[0][0]).toBe('https://wallet-backend.example.com/v1/resolve');
	});
});
