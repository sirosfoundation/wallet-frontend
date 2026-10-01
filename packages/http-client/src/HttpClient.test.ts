import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient } from './HttpClient';
import { HttpClientError } from './resources';
import type { HttpTransport, HttpTransportResponse, IndexedDB } from './types';
import type { Logger } from '@sirosfoundation/browser-log';

const logger = {
	warn: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	error: vi.fn(),
} as unknown as Logger;

const bytes = (s: string) => new TextEncoder().encode(s);

function transportReturning(
	res: Partial<HttpTransportResponse> & { body: Uint8Array },
): HttpTransport {
	return vi.fn(async () => ({ status: 200, headers: {}, ...res }));
}

function memoryIndexedDB(): IndexedDB {
	const store = new Map<string, unknown>();
	return {
		addItem: vi.fn(async (_s, key, value) => {
			store.set(String(key), value);
		}),
		getItem: vi.fn(async (_s, key) => store.get(String(key)) ?? null),
	};
}

describe('HttpClient', () => {
	beforeEach(() => vi.clearAllMocks());

	it('decodes JSON responses by content-type', async () => {
		const transport = transportReturning({
			headers: { 'content-type': 'application/json' },
			body: bytes('{"hello":"world"}'),
		});
		const client = new HttpClient({ isOnline: true, logger, transport });

		const res = await client.get('https://x.test/api');

		expect(res.status).toBe(200);
		expect(res.data).toEqual({ hello: 'world' });
	});

	it('returns text for non-JSON responses', async () => {
		const transport = transportReturning({
			headers: { 'content-type': 'text/plain' },
			body: bytes('plain'),
		});
		const client = new HttpClient({ isOnline: true, logger, transport });

		const res = await client.get('https://x.test/file.txt');

		expect(res.data).toBe('plain');
	});

	it('returns bytes for binary URLs and attaches raw when wantRaw is set', async () => {
		const transport = transportReturning({
			headers: { 'content-type': 'image/png' },
			body: new Uint8Array([1, 2, 3]),
		});
		const client = new HttpClient({ isOnline: true, logger, transport });

		const res = await client.get(
			'https://x.test/logo.png',
			{},
			{ wantRaw: true },
		);

		expect(res.data).toBeInstanceOf(Uint8Array);
		expect(Array.from(res.raw!)).toEqual([1, 2, 3]);
	});

	it('treats binary:true as binary regardless of URL', async () => {
		const transport = transportReturning({ body: new Uint8Array([9]) });
		const client = new HttpClient({ isOnline: true, logger, transport });

		const res = await client.get('https://x.test/data', {}, { binary: true });

		expect(res.data).toBeInstanceOf(Uint8Array);
	});

	it('merges decorateHeaders into the transport request', async () => {
		const transport = vi.fn(async () => ({
			status: 200,
			headers: {},
			body: bytes(''),
		}));
		const client = new HttpClient({
			isOnline: true,
			logger,
			transport,
			decorateHeaders: () => ({ 'X-Tenant-ID': 't1' }),
		});

		await client.get('https://x.test/a', { 'X-Custom': 'c' });

		expect(transport).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: { 'X-Custom': 'c', 'X-Tenant-ID': 't1' },
			}),
		);
	});

	it('returns 504 when offline with no cache', async () => {
		const transport = transportReturning({ body: bytes('x') });
		const client = new HttpClient({ isOnline: false, logger, transport });

		const res = await client.get('https://x.test/a');

		expect(res.status).toBe(504);
		expect(transport).not.toHaveBeenCalled();
	});

	it('caches responses and serves subsequent calls from cache', async () => {
		const transport = transportReturning({
			headers: {
				'content-type': 'application/json',
				'cache-control': 'max-age=60',
			},
			body: bytes('{"n":1}'),
		});
		const client = new HttpClient({
			isOnline: true,
			logger,
			transport,
			indexedDB: memoryIndexedDB(),
		});

		const a = await client.get('https://x.test/c', {}, { useCache: true });
		const b = await client.get('https://x.test/c', {}, { useCache: true });

		expect(a.data).toEqual({ n: 1 });
		expect(b.data).toEqual({ n: 1 });
		expect(transport).toHaveBeenCalledTimes(1);
	});

	it('does not cache when cache-control is no-store', async () => {
		const transport = transportReturning({
			headers: {
				'content-type': 'application/json',
				'cache-control': 'no-store',
			},
			body: bytes('{"n":1}'),
		});
		const client = new HttpClient({
			isOnline: true,
			logger,
			transport,
			indexedDB: memoryIndexedDB(),
		});

		await client.get('https://x.test/c', {}, { useCache: true });
		await client.get('https://x.test/c', {}, { useCache: true });

		expect(transport).toHaveBeenCalledTimes(2);
	});

	it('deduplicates concurrent identical requests', async () => {
		let resolve!: (r: HttpTransportResponse) => void;
		const transport = vi.fn(
			() => new Promise<HttpTransportResponse>((r) => (resolve = r)),
		);
		const client = new HttpClient({ isOnline: true, logger, transport });

		const p1 = client.get('https://x.test/d');
		const p2 = client.get('https://x.test/d');
		resolve({ status: 200, headers: {}, body: bytes('ok') });
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(transport).toHaveBeenCalledTimes(1);
		expect(r1.data).toBe('ok');
		expect(r2.data).toBe('ok');
	});

	it('returns the error payload when the transport throws and no cache exists', async () => {
		const transport = vi.fn(async () => {
			throw new HttpClientError('GET', 503, { x: '1' }, 'nope');
		});
		const client = new HttpClient({ isOnline: true, logger, transport });

		const res = await client.get('https://x.test/e');

		expect(res.status).toBe(503);
		expect(res.data).toBe('nope');
	});

	it('falls back to stale cache when the transport throws', async () => {
		const client = new HttpClient({
			isOnline: true,
			logger,
			transport: transportReturning({
				headers: {
					'content-type': 'application/json',
					'cache-control': 'max-age=60',
				},
				body: bytes('{"ok":true}'),
			}),
			indexedDB: memoryIndexedDB(),
		});

		await client.get('https://x.test/f', {}, { useCache: true });
		client.setTransport(
			vi.fn(async () => {
				throw new HttpClientError('GET', 500, {}, 'err');
			}),
		);
		const res = await client.get('https://x.test/f');

		expect(res.data).toEqual({ ok: true });
	});

	it('setTransport swaps the active transport', async () => {
		const client = new HttpClient({
			isOnline: true,
			logger,
			transport: transportReturning({ body: bytes('one') }),
		});
		expect((await client.get('https://x.test/g')).data).toBe('one');

		client.setTransport(transportReturning({ body: bytes('two') }));
		expect((await client.get('https://x.test/g')).data).toBe('two');
	});
});
