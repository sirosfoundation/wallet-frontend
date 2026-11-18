import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HttpClient, HttpResponse } from '@sirosfoundation/http-client';
import { TokenStatusListsBackendSource } from './TokenStatusListsBackendSource';

const URI = 'https://issuer.example/lists/1';

describe('TokenStatusListsBackendSource', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('posts the lists with the bearer token and returns parsed results', async () => {
		const { source, post } = setup({
			data: {
				results: [
					{
						uri: URI,
						state: 'not_modified',
						etag: 'e1',
						expires_at: 1_700_000_000,
						signer_trust: 'trusted',
					},
				],
			},
		});

		const results = await source.fetchLists([{ uri: URI, etag: 'e1' }]);

		expect(post).toHaveBeenCalledWith(
			'https://backend.example/status/v1/lists',
			{ lists: [{ uri: URI, etag: 'e1' }] },
			{ Authorization: 'Bearer token' },
		);
		expect(results).toEqual([
			{
				uri: URI,
				state: 'not_modified',
				etag: 'e1',
				expiresAt: 1_700_000_000,
				signerTrust: 'trusted',
			},
		]);
	});

	it.each([401, 403])('throws auth on %i', async (status) => {
		const { source } = setup({ status });

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'auth',
		});
		expect(source.isAvailable()).toBe(true);
	});

	it.each([400, 404, 413])('throws rejected on %i', async (status) => {
		const { source } = setup({ status });

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'rejected',
		});
		expect(source.isAvailable()).toBe(true);
	});

	it('pauses for Retry-After seconds on 429', async () => {
		const { source } = setup({ status: 429, headers: { 'retry-after': '30' } });

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'rate_limited',
		});
		expect(source.isAvailable()).toBe(false);

		vi.advanceTimersByTime(29_000);
		expect(source.isAvailable()).toBe(false);

		vi.advanceTimersByTime(1_000);
		expect(source.isAvailable()).toBe(true);
	});

	it('pauses for 60 seconds on 429 without Retry-After', async () => {
		const { source } = setup({ status: 429 });

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'rate_limited',
		});

		vi.advanceTimersByTime(59_000);
		expect(source.isAvailable()).toBe(false);

		vi.advanceTimersByTime(1_000);
		expect(source.isAvailable()).toBe(true);
	});

	it('stops for good on 503 STATUS_NOT_SUPPORTED', async () => {
		const { source } = setup({
			status: 503,
			data: { error: 'STATUS_NOT_SUPPORTED' },
		});

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'not_supported',
		});

		vi.advanceTimersByTime(1000 * 60 * 60 * 24);
		expect(source.isAvailable()).toBe(false);
	});

	it.each([
		{ status: 503, data: { error: 'SOMETHING_ELSE' } },
		{ status: 500, data: undefined },
	])(
		'throws network on other errors ($status) and stays available',
		async (response) => {
			const { source } = setup(response);

			await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
				kind: 'network',
			});
			expect(source.isAvailable()).toBe(true);
		},
	);

	it('throws malformed on an unexpected body', async () => {
		const { source } = setup({
			data: { results: [{ uri: URI, state: 'nope' }] },
		});

		await expect(source.fetchLists([{ uri: URI }])).rejects.toMatchObject({
			kind: 'malformed',
		});
	});
});

function setup(response: Partial<HttpResponse>) {
	const post = vi
		.fn()
		.mockResolvedValue({
			status: 200,
			headers: {},
			data: undefined,
			...response,
		});
	const source = new TokenStatusListsBackendSource({
		httpClient: { post } as unknown as HttpClient,
		getAuthToken: async () => 'token',
		backendUrl: 'https://backend.example',
	});
	return { source, post };
}
