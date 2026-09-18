import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWK } from 'jose';
import { WscdManagerWorkerHost } from './WscdManagerWorkerHost';
import { WscdManagerError, WscdPlugin, type WscdContainer } from '../resources';
import { ensureEncodedWscdContainer } from '../utils';
import type { WorkerMessage, WorkerResponse } from '../types';

// A fake Worker that records every postMessage and lets the test drive the
// response back through the host's onmessage handler.
const { FakeWorker, workerInstances } = vi.hoisted(() => {
	class FakeWorker {
		onmessage: ((event: { data: unknown }) => void) | null = null;
		posted: Array<WorkerMessage & { id: number }> = [];
		constructor() {
			workerInstances.push(this as unknown as FakeWorker);
		}
		postMessage(message: WorkerMessage & { id: number }) {
			this.posted.push(message);
		}
		terminate() {}
	}
	const workerInstances: FakeWorker[] = [];
	return { FakeWorker, workerInstances };
});

type FakeWorkerInstance = {
	onmessage: ((event: { data: unknown }) => void) | null;
	posted: Array<WorkerMessage & { id: number }>;
};

vi.mock('../worker?worker', () => ({ default: FakeWorker }));
vi.mock('@/config', () => ({ WEBAUTHN_RPID: 'wallet.example.com' }));
vi.mock('@/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const publicKeyJwk: JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'hvLS5qgKNmpKnA46YSRft2AHyDk9QZGIuq2t8SXmtsE',
	y: '_O6ZbDIE6K_jmzgORF3DW-sSGVuigXIP9XMdPyGSOS0',
};

const publicKeyKid = 'q95J3MNIjVVGXyrmJVm5Vfr6E-iGfIF0Bo4XZAGhFf4';

beforeEach(() => {
	workerInstances.length = 0;
	vi.clearAllMocks();
	if (!('Worker' in window)) {
		(window as unknown as { Worker: unknown }).Worker = FakeWorker;
	}
});

describe('WscdManagerWorkerHost.initialize', () => {
	it('constructs a worker and wires its onmessage handler', async () => {
		const { worker } = await makeHost();
		expect(workerInstances).toHaveLength(1);
		expect(typeof worker.onmessage).toBe('function');
	});
});

describe('WscdManagerWorkerHost.generateKey', () => {
	it('posts a generate_key message and resolves with the returned handle', async () => {
		const { host, worker } = await makeHost();

		const promise = host.generateKey();
		expect(lastPosted(worker)).toMatchObject({ action: 'generate_key' });
		expect(typeof lastPosted(worker).id).toBe('number');

		respondToLast(worker, { result: publicKeyKid });
		await expect(promise).resolves.toBe(publicKeyKid);
	});
});

describe('WscdManagerWorkerHost.exportPublicKey', () => {
	it('posts an export_public_key message with the kid and resolves with the JWK', async () => {
		const { host, worker } = await makeHost();

		const promise = host.exportPublicKey(publicKeyKid);
		expect(lastPosted(worker)).toMatchObject({
			action: 'export_public_key',
			kid: publicKeyKid,
		});

		respondToLast(worker, { result: publicKeyJwk });
		await expect(promise).resolves.toEqual(publicKeyJwk);
	});
});

describe('WscdManagerWorkerHost.sign', () => {
	it('posts a sign_request message with the kid and data, resolving with the signature', async () => {
		const { host, worker } = await makeHost();
		const data = new Uint8Array([1, 2, 3]);
		const signature = new Uint8Array([9, 9, 9]);

		const promise = host.sign(publicKeyKid, data);
		expect(lastPosted(worker)).toMatchObject({
			action: 'sign_request',
			kid: publicKeyKid,
			data,
		});

		respondToLast(worker, { result: signature });
		await expect(promise).resolves.toEqual(signature);
	});
});

describe('WscdManagerWorkerHost.importContainer', () => {
	it('posts an import_container message with the encoded container bytes', async () => {
		const { host, worker } = await makeHost();
		const container = makeContainer();

		const promise = host.importContainer(container);
		const message = lastPosted(worker);
		expect(message.action).toBe('import_container');

		const posted = (
			message as Extract<WorkerMessage, { action: 'import_container' }>
		).container;
		expect(posted).toBeInstanceOf(Uint8Array);
		expect(JSON.parse(new TextDecoder().decode(posted))).toEqual(container);

		respondToLast(worker, { result: true });
		await expect(promise).resolves.toBeUndefined();
	});
});

describe('WscdManagerWorkerHost.exportContainer', () => {
	it('posts an export_container message and decodes the returned bytes', async () => {
		const { host, worker } = await makeHost();
		const container = makeContainer();

		const promise = host.exportContainer();
		expect(lastPosted(worker)).toMatchObject({ action: 'export_container' });

		respondToLast(worker, { result: ensureEncodedWscdContainer(container) });
		await expect(promise).resolves.toEqual(container);
	});
});

describe('WscdManagerWorkerHost.isAvailable', () => {
	it('pings the worker and returns true when it pongs', async () => {
		const { host, worker } = await makeHost();

		const promise = host.isAvailable();
		expect(lastPosted(worker)).toMatchObject({ action: 'ping' });

		respondToLast(worker, { result: true });
		await expect(promise).resolves.toBe(true);
	});

	it('returns false when the worker responds with something other than true', async () => {
		const { host, worker } = await makeHost();

		const promise = host.isAvailable();
		respondToLast(worker, { result: false as unknown as true });
		await expect(promise).resolves.toBe(false);
	});

	it('returns false when the environment has no Worker', async () => {
		const { host } = await makeHost();
		const original = (window as unknown as { Worker: unknown }).Worker;
		(window as unknown as { Worker: unknown }).Worker = undefined;

		try {
			await expect(host.isAvailable()).resolves.toBe(false);
		} finally {
			(window as unknown as { Worker: unknown }).Worker = original;
		}
	});
});

describe('WscdManagerWorkerHost.isEligible', () => {
	it('accepts a supported plugin with a satisfiable factor', async () => {
		const { host } = await makeHost();
		await expect(
			host.isEligible({
				plugin: WscdPlugin.SOFTKEY,
				factors: [{ kind: 'none' }],
			}),
		).resolves.toBe(true);
	});

	it('accepts a webauthn factor bound to the configured rpId', async () => {
		const { host } = await makeHost();
		await expect(
			host.isEligible({
				plugin: WscdPlugin.FIDO2,
				factors: [{ kind: 'webauthn', rpId: 'wallet.example.com' }],
			}),
		).resolves.toBe(true);
	});

	it('rejects a webauthn factor bound to a different rpId', async () => {
		const { host } = await makeHost();
		await expect(
			host.isEligible({
				plugin: WscdPlugin.FIDO2,
				factors: [{ kind: 'webauthn', rpId: 'evil.example.com' }],
			}),
		).resolves.toBe(false);
	});
});

describe('WscdManagerWorkerHost message correlation', () => {
	it('routes each response to its own request by id, even out of order', async () => {
		const { host, worker } = await makeHost();

		const first = host.generateKey();
		const firstId = lastPosted(worker).id;
		const second = host.generateKey();
		const secondId = lastPosted(worker).id;
		expect(firstId).not.toBe(secondId);

		worker.onmessage?.({ data: { id: secondId, result: 'second' } });
		worker.onmessage?.({ data: { id: firstId, result: 'first' } });

		await expect(first).resolves.toBe('first');
		await expect(second).resolves.toBe('second');
	});

	it('rejects with a WscdManagerError when the worker reports an error', async () => {
		const { host, worker } = await makeHost();

		const promise = host.generateKey();
		respondToLast(worker, { error: 'boom' });

		await expect(promise).rejects.toBeInstanceOf(WscdManagerError);
		await expect(promise).rejects.toThrow('boom');
	});

	it('ignores responses whose id has no pending request', async () => {
		const { host, worker } = await makeHost();

		const promise = host.generateKey();
		const { id } = lastPosted(worker);

		worker.onmessage?.({ data: { id: id + 999, result: 'stray' } });
		respondToLast(worker, { result: publicKeyKid });

		await expect(promise).resolves.toBe(publicKeyKid);
	});
});

function makeContainer(): WscdContainer {
	return {
		keys: [
			{ kid: publicKeyKid, algorithm: 'ES256', d: 'ZmFrZQ', created_at: 0 },
		],
		lifecycle: {},
	};
}

function lastPosted(worker: FakeWorkerInstance) {
	return worker.posted[worker.posted.length - 1];
}

function respondToLast(
	worker: FakeWorkerInstance,
	response: Partial<WorkerResponse>,
) {
	worker.onmessage?.({ data: { id: lastPosted(worker).id, ...response } });
}

async function makeHost(): Promise<{
	host: WscdManagerWorkerHost;
	worker: FakeWorkerInstance;
}> {
	const host = new WscdManagerWorkerHost();
	await host.initialize();
	return { host, worker: workerInstances[workerInstances.length - 1] };
}
