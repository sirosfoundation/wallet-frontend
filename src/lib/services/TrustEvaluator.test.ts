import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@sirosfoundation/http-client';
import { TrustStatus } from '@sirosfoundation/authzen-client';
import { createVerifierTrustEvaluator } from './TrustEvaluator';

const { evaluateVerifier } = vi.hoisted(() => ({ evaluateVerifier: vi.fn() }));

vi.mock('@sirosfoundation/authzen-client', async (importOriginal) => ({
	...(await importOriginal<typeof import('@sirosfoundation/authzen-client')>()),
	AuthZENClient: vi.fn(function () {
		return { evaluateVerifier };
	}),
}));

describe('createVerifierTrustEvaluator', () => {
	beforeEach(() => {
		evaluateVerifier.mockReset();
	});

	it('passes clientIdScheme.identifier to evaluateVerifier', async () => {
		evaluateVerifier.mockResolvedValue({
			ok: true,
			value: {
				status: TrustStatus.TRUSTED,
				metadata: {},
			},
		});

		const evaluateTrust = createVerifierTrustEvaluator({
			httpClient: {} as HttpClient,
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
