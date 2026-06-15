import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as walletCommon from 'wallet-common';
import { createVerifierTrustEvaluator } from './TrustEvaluator';

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
