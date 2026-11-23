// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { WmpClient, WmpRpcError } from '../wmp/WmpClient';

vi.mock('@/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const RPC = 'https://engine.test/api/v2/wallet/rpc';

/** A fetch that never answers, but gives up when its request is aborted. */
const hangingFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
	init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
});

describe('WmpClient requests', () => {
	it('gives up on a request the backend never answers', async () => {
		const client = new WmpClient(RPC, () => 'tok', { fetchImpl: hangingFetch, requestTimeoutMs: 50 });
		const call = client.call('wmp.flow.action', { flow_id: 'f' });
		await expect(call).rejects.toBeInstanceOf(WmpRpcError);
		await expect(call).rejects.toThrow('WMP request timed out');
	});

	it('returns the answer when the backend answers in time', async () => {
		const fetchImpl: typeof fetch = async (_input, init) => {
			const { id } = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { status: 'accepted' } }), { status: 200 });
		};
		const client = new WmpClient(RPC, () => 'tok', { fetchImpl, requestTimeoutMs: 50 });
		await expect(client.call('wmp.flow.action', { flow_id: 'f' })).resolves.toEqual({ status: 'accepted' });
	});

	it('passes on a network failure as it is, not as a timeout', async () => {
		const fetchImpl: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
		const client = new WmpClient(RPC, () => 'tok', { fetchImpl, requestTimeoutMs: 50 });
		await expect(client.call('wmp.flow.action', {})).rejects.toThrow('Failed to fetch');
	});
});