import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { base64url } from 'jose';
import type { Logger } from '@sirosfoundation/browser-log';
import { TokenStatusLists } from './TokenStatusLists';
import { StatusList, TokenStatus } from './resources';
import type {
	CachedTokenStatusList,
	ITokenStatusListsSource,
	ITokenStatusListStorage,
	TokenEntity,
	TokenId,
} from './types';

const A = 'https://issuer.example/lists/a';
const B = 'https://issuer.example/lists/b';
const INTERVAL = 1000 * 60 * 5;
const START = new Date('2026-01-01T00:00:00Z');
const NOW = START.getTime() / 1000;

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as Logger;

describe('TokenStatusLists', () => {
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: [
				'setTimeout',
				'clearTimeout',
				'setInterval',
				'clearInterval',
				'Date',
			],
		});
		vi.setSystemTime(START);
	});
	afterEach(() => vi.useRealTimers());

	it('reads statuses from a fetched list', async () => {
		// 2-bit entries: VALID, INVALID, SUSPENDED, VALID
		const list = await verified(A, [0b00_10_01_00]);
		const { service, listener } = setup(() => [list]);

		service.setTokens(
			tokens([
				[1, { uri: A, idx: 0 }],
				[2, { uri: A, idx: 1 }],
				[3, { uri: A, idx: 2 }],
			]),
		);

		await vi.waitFor(() => expect(service.getStatuses().size).toBe(3));
		expect(service.getStatuses()).toEqual(
			new Map([
				[1, TokenStatus.VALID],
				[2, TokenStatus.INVALID],
				[3, TokenStatus.SUSPENDED],
			]),
		);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('marks a token PENDING when the list is older than the token', async () => {
		const list = await verified(A, [0], { iat: NOW - 100 });
		const { service } = setup(() => [list]);

		service.setTokens(tokens([[1, { uri: A, idx: 0, iat: NOW }]]));

		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.PENDING),
		);
	});

	it('marks an out-of-range index UNKNOWN and reports it', async () => {
		const list = await verified(A, [0]);
		const { service, onError } = setup(() => [list]);

		service.setTokens(tokens([[1, { uri: A, idx: 10 }]]));

		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.UNKNOWN),
		);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'out_of_range' }),
		);
	});

	it('still updates other lists when one fails to decompress', async () => {
		const lists: Record<string, StatusList> = {
			[A]: await verified(A, [0]),
			[B]: { ...(await verified(B, [0])), lst: 'not-zlib' } as StatusList,
		};
		const { service, onError } = setup((batch) =>
			batch.map(({ uri }) => lists[uri]),
		);

		service.setTokens(
			tokens([
				[1, { uri: A, idx: 0 }],
				[2, { uri: B, idx: 0 }],
			]),
		);

		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.VALID),
		);
		expect(service.getStatuses().has(2)).toBe(false);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'malformed' }),
		);
	});

	it('sends the etag on expiry and keeps the list on not_modified', async () => {
		const responses: StatusList[][] = [
			[await verified(A, [0b01], { ttl: 60, etag: 'e1' })],
			[
				{
					uri: A,
					state: 'not_modified',
					etag: 'e1',
					expiresAt: NOW + 3600,
					signerTrust: 'trusted',
				},
			],
		];
		const { service, source, storage } = setup(() => responses.shift() ?? []);

		service.setTokens(tokens([[1, { uri: A, idx: 0 }]]));
		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.INVALID),
		);

		await vi.advanceTimersByTimeAsync(INTERVAL);
		await vi.waitFor(() => expect(source.fetchLists).toHaveBeenCalledTimes(2));
		expect(source.fetchLists).toHaveBeenLastCalledWith([
			{ uri: A, etag: 'e1' },
		]);

		await vi.waitFor(async () =>
			expect((await storage.get(A))?.expiresAt).toBe((NOW + 3600) * 1000),
		);
		expect(service.getStatuses().get(1)).toBe(TokenStatus.INVALID);
	});

	it('keeps the last status on undetermined and backs off', async () => {
		const undetermined: StatusList = {
			uri: A,
			state: 'undetermined',
			reason: 'fetch_failed',
		};
		const responses: StatusList[][] = [
			[await verified(A, [0b01], { ttl: 60 })],
		];
		const { service, source } = setup(
			() => responses.shift() ?? [undetermined],
		);

		service.setTokens(tokens([[1, { uri: A, idx: 0 }]]));
		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.INVALID),
		);

		await vi.advanceTimersByTimeAsync(INTERVAL);
		await vi.waitFor(() => expect(source.fetchLists).toHaveBeenCalledTimes(2));
		expect(service.getStatuses().get(1)).toBe(TokenStatus.INVALID);

		// Backing off for 10 minutes, so the next tick skips the list.
		await vi.advanceTimersByTimeAsync(INTERVAL);
		expect(source.fetchLists).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(INTERVAL * 2);
		await vi.waitFor(() => expect(source.fetchLists).toHaveBeenCalledTimes(3));
	});

	it('stops fetching once the source is unavailable', async () => {
		const lists: Record<string, StatusList> = {
			[A]: await verified(A, [0]),
			[B]: await verified(B, [0]),
		};
		const { service, source, setAvailable } = setup((batch) => {
			setAvailable(false);
			return batch.map(({ uri }) => lists[uri]);
		});

		service.setTokens(
			tokens([
				[1, { uri: A, idx: 0 }],
				[2, { uri: B, idx: 0 }],
			]),
		);

		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.VALID),
		);
		expect(source.fetchLists).toHaveBeenCalledTimes(1);
		expect(service.getStatuses().has(2)).toBe(false);
	});

	it('reports removed tokens as undefined and drops unused lists', async () => {
		const list = await verified(A, [0]);
		const { service, storage, listener } = setup(() => [list]);

		service.setTokens(tokens([[1, { uri: A, idx: 0 }]]));
		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.VALID),
		);
		listener.mockClear();

		service.setTokens(new Map());

		await vi.waitFor(() =>
			expect(listener).toHaveBeenCalledWith(new Map([[1, undefined]])),
		);
		expect(service.getStatuses().size).toBe(0);
		expect(await storage.getAll()).toEqual([]);
	});

	it('stops checking after dispose', async () => {
		const list = await verified(A, [0], { ttl: 60 });
		const { service, source } = setup(() => [list]);

		service.setTokens(tokens([[1, { uri: A, idx: 0 }]]));
		await vi.waitFor(() =>
			expect(service.getStatuses().get(1)).toBe(TokenStatus.VALID),
		);

		service.dispose();
		await vi.advanceTimersByTimeAsync(INTERVAL * 2);

		expect(source.fetchLists).toHaveBeenCalledTimes(1);
	});
});

async function compress(bytes: number[]): Promise<string> {
	const stream = new Blob([new Uint8Array(bytes)])
		.stream()
		.pipeThrough(new CompressionStream('deflate'));
	return base64url.encode(
		new Uint8Array(await new Response(stream).arrayBuffer()),
	);
}

async function verified(
	uri: string,
	bytes: number[],
	{
		iat = NOW,
		ttl = 3600,
		etag = 'e1',
	}: { iat?: number; ttl?: number; etag?: string } = {},
): Promise<StatusList> {
	return {
		uri,
		state: 'verified',
		bits: 2,
		lst: await compress(bytes),
		iat,
		etag,
		expiresAt: NOW + ttl,
		signerTrust: 'trusted',
	};
}

function memoryStorage(): ITokenStatusListStorage {
	const map = new Map<string, CachedTokenStatusList>();
	return {
		get: async (uri) => map.get(uri),
		set: async (uri, list) => void map.set(uri, list),
		delete: async (uri) => void map.delete(uri),
		getAll: async () => [...map.values()],
	};
}

function tokens(entries: [TokenId, TokenEntity][]) {
	return new Map(entries);
}

function setup(
	respond: (batch: { uri: string; etag?: string }[]) => StatusList[],
) {
	let available = true;
	const source = {
		isAvailable: vi.fn(() => available),
		fetchLists: vi.fn(async (batch: { uri: string; etag?: string }[]) =>
			respond(batch),
		),
	} satisfies ITokenStatusListsSource;
	const storage = memoryStorage();
	const onError = vi.fn();
	const listener = vi.fn();
	const service = new TokenStatusLists(
		{ logger, storage, refreshListOnExpiry: true, onError },
		source,
	);
	service.subscribe(listener);

	return {
		service,
		source,
		storage,
		onError,
		listener,
		setAvailable: (value: boolean) => {
			available = value;
		},
	};
}
