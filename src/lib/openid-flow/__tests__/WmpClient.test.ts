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


describe('WmpClient token refresh', () => {
	it('retries a request once with a fresh token after a 401', async () => {
		const seen: string[] = [];
		const fetchImpl: typeof fetch = async (_input, init) => {
			const auth = (init?.headers as Record<string, string>).Authorization;
			seen.push(auth);
			if (auth === 'Bearer old') return new Response('', { status: 401 });
			const { id } = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }), { status: 200 });
		};
		let token = 'old';
		const onUnauthorized = vi.fn(() => { token = 'new'; return true; });
		const client = new WmpClient(RPC, async () => token, { fetchImpl, onUnauthorized });

		await expect(client.call('wmp.flow.action', {})).resolves.toEqual({ ok: true });
		expect(seen).toEqual(['Bearer old', 'Bearer new']);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it('gives up after one retry, or when no fresh token may be tried', async () => {
		let calls = 0;
		const fetchImpl: typeof fetch = async () => { calls++; return new Response('', { status: 401 }); };

		const refusing = new WmpClient(RPC, () => 't', { fetchImpl, onUnauthorized: () => false });
		await expect(refusing.call('wmp.flow.action', {})).rejects.toThrow('WMP HTTP 401');
		expect(calls).toBe(1);

		calls = 0;
		const retrying = new WmpClient(RPC, () => 't', { fetchImpl, onUnauthorized: () => true });
		await expect(retrying.call('wmp.flow.action', {})).rejects.toThrow('WMP HTTP 401');
		expect(calls).toBe(2);
	});

	it('reopens the event stream with a fresh token when it is refused with 401', async () => {
		let token = 'old';
		const streamTokens: string[] = [];
		let streams = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const headers = init?.headers as Record<string, string>;
			if (init?.method === 'GET') {
				streamTokens.push(headers.Authorization);
				streams++;
				if (streams === 2) return new Response('', { status: 401 });
				// The first stream ends at once (a dropped connection); the third stays open.
				const body = new ReadableStream<Uint8Array>({ start: (c) => { if (streams === 1) c.close(); } });
				return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
			}
			const { id } = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { wmp: { version: '0.1', session_id: 's1' } } }), { status: 200 });
		};
		const lost = vi.fn();
		const client = new WmpClient(RPC, async () => token, {
			fetchImpl,
			onUnauthorized: () => { token = 'new'; return true; },
		});
		client.onStreamLost(lost);

		await client.open({});
		await vi.waitFor(() => expect(streams).toBe(3), { timeout: 3000 });
		expect(streamTokens).toEqual(['Bearer old', 'Bearer old', 'Bearer new']);
		expect(lost).not.toHaveBeenCalled();
		await client.close();
	});
});