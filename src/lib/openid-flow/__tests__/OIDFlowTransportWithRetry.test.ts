/**
 * OIDFlowTransportWithRetry: releasing a flow cancels the retry loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OIDFlowTransportWithRetry } from '../decorators/OIDFlowTransportWithRetry';
import { OIDFlowWebSocketTransport } from '../transports/OIDFlowWebSocketTransport';
import { OIDFlowStateStore } from '../OIDFlowStateStore';
import type { IOIDFlowTransport } from '../types/IOIDFlowTransport';
import type { MockWebSocket } from './helpers/mockWebSocket';
import { installMockWebSocket, sockets } from './helpers/mockWebSocket';

const RETRY = { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10_000, backoffMultiplier: 2 };
const RECOVERABLE = new Error('network connection lost');
const offer = { preAuthorizedCode: 'code' };

function innerTransport(overrides: Partial<Record<keyof IOIDFlowTransport, unknown>> = {}) {
	return {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
		releaseFlow: vi.fn(),
		startOID4VCIFlow: vi.fn(),
		startOID4VPFlow: vi.fn(),
		request: vi.fn(),
		...overrides,
	} as unknown as IOIDFlowTransport & {
		startOID4VCIFlow: ReturnType<typeof vi.fn>;
		startOID4VPFlow: ReturnType<typeof vi.fn>;
		releaseFlow: ReturnType<typeof vi.fn>;
		connect: ReturnType<typeof vi.fn>;
		isConnected: ReturnType<typeof vi.fn>;
	};
}

function wrap(inner: IOIDFlowTransport) {
	return new OIDFlowTransportWithRetry(inner, { retryConfig: RETRY, stateManager: new OIDFlowStateStore() });
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('OIDFlowTransportWithRetry.releaseFlow', () => {
	it('retries a recoverable failure when nothing was released (control)', async () => {
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockRejectedValueOnce(RECOVERABLE).mockResolvedValue({ success: true });

		const result = wrap(inner).startOID4VCIFlow(offer);
		await vi.advanceTimersByTimeAsync(RETRY.initialDelayMs * 2);

		await expect(result).resolves.toEqual({ success: true });
		expect(inner.startOID4VCIFlow).toHaveBeenCalledTimes(2);
	});

	it('does not retry after a release during the backoff of a thrown error', async () => {
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockRejectedValue(RECOVERABLE);
		const retrying = wrap(inner);

		const result = retrying.startOID4VCIFlow(offer);
		const settled = result.then(() => 'resolved', (error) => error);
		await vi.advanceTimersByTimeAsync(10); // the first attempt failed; now in the backoff
		retrying.releaseFlow();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);

		expect(await settled).toMatchObject({ code: 'FLOW_RELEASED', message: 'The flow was released locally' });
		expect(inner.startOID4VCIFlow).toHaveBeenCalledTimes(1);
		expect(inner.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('does not retry after a release during the backoff of a failed result', async () => {
		const inner = innerTransport();
		inner.startOID4VPFlow.mockResolvedValue({ success: false, error: { code: 'NETWORK_TIMEOUT', message: 'network timeout' } });
		const retrying = wrap(inner);

		const result = retrying.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' });
		const settled = result.then(() => 'resolved', (error) => error);
		await vi.advanceTimersByTimeAsync(10);
		retrying.releaseFlow();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);

		expect(await settled).toMatchObject({ code: 'FLOW_RELEASED' });
		expect(inner.startOID4VPFlow).toHaveBeenCalledTimes(1);
	});

	it('does not start the operation after a release while it was reconnecting', async () => {
		let finishConnect!: () => void;
		const inner = innerTransport({
			isConnected: vi.fn().mockReturnValue(false),
			connect: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishConnect = resolve; })),
		});
		inner.startOID4VCIFlow.mockRejectedValue(RECOVERABLE);
		const retrying = wrap(inner);

		const settled = retrying.startOID4VCIFlow(offer).then(() => 'resolved', (error) => error);
		await vi.advanceTimersByTimeAsync(RETRY.initialDelayMs * 2); // backoff over, now reconnecting
		expect(inner.connect).toHaveBeenCalledTimes(1);
		retrying.releaseFlow();
		finishConnect();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);

		expect(await settled).toMatchObject({ code: 'FLOW_RELEASED' });
		expect(inner.startOID4VCIFlow).toHaveBeenCalledTimes(1);
	});

	it('does not report success for an operation that finished after the release', async () => {
		let finish!: (value: unknown) => void;
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
		const retrying = wrap(inner);

		const settled = retrying.startOID4VCIFlow(offer).then((value) => ({ value }), (error) => error);
		await vi.advanceTimersByTimeAsync(10);
		retrying.releaseFlow();
		finish({ success: true, credentials: [{ credential: 'secret' }] });
		await vi.advanceTimersByTimeAsync(10);

		const outcome = await settled;
		expect(outcome).toMatchObject({ code: 'FLOW_RELEASED' });
		expect(JSON.stringify(outcome)).not.toContain('secret');
	});

	it('does not retry a failure that arrives after the release, whatever the error: no backoff, no retry callback', async () => {
		let fail!: (error: Error) => void;
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
		const onRetry = vi.fn();
		const retrying = new OIDFlowTransportWithRetry(inner, { retryConfig: RETRY, stateManager: new OIDFlowStateStore(), onRetry });
		let outcome: unknown = 'pending';
		retrying.startOID4VCIFlow(offer).then(() => { outcome = 'resolved'; }, (error) => { outcome = error; });
		await vi.advanceTimersByTimeAsync(10);

		retrying.releaseFlow();
		fail(RECOVERABLE);
		await vi.advanceTimersByTimeAsync(10); // far less than the first backoff (1000 ms)

		expect(outcome).toMatchObject({ code: 'FLOW_RELEASED' });
		expect(onRetry).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);
		expect(inner.startOID4VCIFlow).toHaveBeenCalledTimes(1);
	});

	it('leaves an operation started after the release alone: it retries normally', async () => {
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockRejectedValueOnce(RECOVERABLE).mockResolvedValue({ success: true });
		const retrying = wrap(inner);
		retrying.releaseFlow();

		const result = retrying.startOID4VCIFlow(offer);
		await vi.advanceTimersByTimeAsync(RETRY.initialDelayMs * 2);

		await expect(result).resolves.toEqual({ success: true });
		expect(inner.startOID4VCIFlow).toHaveBeenCalledTimes(2);
	});

	it('forgets the cancelled flow’s recovery state', async () => {
		const inner = innerTransport();
		inner.startOID4VCIFlow.mockRejectedValue(RECOVERABLE);
		const store = new OIDFlowStateStore();
		const retrying = new OIDFlowTransportWithRetry(inner, { retryConfig: RETRY, stateManager: store });

		const settled = retrying.startOID4VCIFlow(offer).then(() => 'resolved', (error) => error);
		await vi.advanceTimersByTimeAsync(10);
		expect(store.getActiveFlows().length).toBeGreaterThan(0);
		retrying.releaseFlow();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);
		await settled;

		expect(store.getActiveFlows()).toHaveLength(0);
	});
});

describe('a released flow never starts a new flow id (real WebSocket transport underneath)', () => {
	let restoreWebSocket: () => void;

	beforeEach(() => {
		restoreWebSocket = installMockWebSocket();
	});
	afterEach(() => {
		restoreWebSocket();
	});

	const flowStarts = (ws: MockWebSocket) =>
		ws.sentMessages.map((m) => JSON.parse(m)).filter((m) => m.type === 'flow_start');

	async function connected() {
		const transport = new OIDFlowWebSocketTransport('wss://test.example.com/api/v2/wallet', 'token');
		const connecting = transport.connect();
		await vi.advanceTimersByTimeAsync(10);
		await connecting;
		return { transport, ws: sockets[0] };
	}

	it('sends no second flow_start after a release during the backoff', async () => {
		const { transport, ws } = await connected();
		const retrying = new OIDFlowTransportWithRetry(transport, { retryConfig: RETRY, stateManager: new OIDFlowStateStore() });

		const settled = retrying
			.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' })
			.then(() => 'resolved', (error) => error);
		await vi.advanceTimersByTimeAsync(10);
		expect(flowStarts(ws)).toHaveLength(1);
		const firstFlowId = flowStarts(ws)[0].flow_id;
		ws.simulateMessage({ type: 'flow_error', flow_id: firstFlowId, error: { code: 'NETWORK_TIMEOUT', message: 'network timeout' } });
		await vi.advanceTimersByTimeAsync(10); // the failure is in, the retry is backing off

		retrying.releaseFlow();
		await vi.advanceTimersByTimeAsync(RETRY.maxDelayMs * 4);

		expect(await settled).toMatchObject({ code: 'FLOW_RELEASED' });
		expect(flowStarts(ws)).toHaveLength(1);
		expect(flowStarts(ws)[0].flow_id).toBe(firstFlowId);
	});

	it('does send the second flow_start when nothing was released (control)', async () => {
		const { transport, ws } = await connected();
		const retrying = new OIDFlowTransportWithRetry(transport, { retryConfig: RETRY, stateManager: new OIDFlowStateStore() });

		retrying.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' }).catch(() => undefined);
		await vi.advanceTimersByTimeAsync(10);
		ws.simulateMessage({ type: 'flow_error', flow_id: flowStarts(ws)[0].flow_id, error: { code: 'NETWORK_TIMEOUT', message: 'network timeout' } });
		await vi.advanceTimersByTimeAsync(RETRY.initialDelayMs * 2);

		expect(flowStarts(ws)).toHaveLength(2);
		expect(flowStarts(ws)[1].flow_id).not.toBe(flowStarts(ws)[0].flow_id);
	});
});
