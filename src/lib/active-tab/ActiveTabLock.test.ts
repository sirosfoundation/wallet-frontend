import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActiveTabLock, type OnHandedOver, type OnTakenOver } from './ActiveTabLock';

vi.mock('@/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const LOCK_NAME = 'wallet-active-tab';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type LockRequest = {
	callback: (lock: Lock | null) => unknown;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
};

/**
 * In-memory Web Locks for a single exclusive lock, with ifAvailable, steal and
 * signal support.
 */
class FakeLockManager {
	held?: LockRequest;
	queue: LockRequest[] = [];

	request(_name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const request = { callback, resolve, reject };

			if (options.steal) {
				this.held?.reject(new DOMException('The lock was stolen', 'AbortError'));
				this.held = undefined;
				this.#grant(request);
			} else if (!this.held && this.queue.length === 0) {
				this.#grant(request);
			} else if (options.ifAvailable) {
				Promise.resolve(callback(null)).then(resolve, reject);
			} else {
				this.queue.push(request);
				options.signal?.addEventListener('abort', () => {
					const index = this.queue.indexOf(request);
					if (index === -1) return;
					this.queue.splice(index, 1);
					reject(options.signal!.reason);
				});
			}
		});
	}

	#grant(request: LockRequest): void {
		this.held = request;
		Promise.resolve()
			.then(() => request.callback({ name: LOCK_NAME, mode: 'exclusive' } as Lock))
			.then(request.resolve, request.reject)
			.finally(() => {
				if (this.held !== request) return;
				this.held = undefined;
				const next = this.queue.shift();
				if (next) this.#grant(next);
			});
	}
}

/**
 * In-memory BroadcastChannel; delivers to every other open channel with the same name.
 */
class FakeBroadcastChannel {
	static open = new Set<FakeBroadcastChannel>();

	readonly name: string;
	#listeners = new Set<(event: MessageEvent) => void>();

	constructor(name: string) {
		this.name = name;
		FakeBroadcastChannel.open.add(this);
	}

	postMessage(data: unknown): void {
		for (const channel of FakeBroadcastChannel.open) {
			if (channel === this || channel.name !== this.name) continue;
			queueMicrotask(() => {
				if (!FakeBroadcastChannel.open.has(channel)) return;
				for (const listener of channel.#listeners) {
					listener({ data: structuredClone(data) } as MessageEvent);
				}
			});
		}
	}

	addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
		this.#listeners.add(listener);
	}

	removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
		this.#listeners.delete(listener);
	}

	close(): void {
		FakeBroadcastChannel.open.delete(this);
	}
}

describe('ActiveTabLock', () => {
	let locks: FakeLockManager;
	const created: ActiveTabLock[] = [];

	function createTab({
		onTakenOver = vi.fn<OnTakenOver>(() => undefined),
		onHandedOver = vi.fn<OnHandedOver>(),
	}: {
		onTakenOver?: OnTakenOver;
		onHandedOver?: OnHandedOver;
	} = {}) {
		const lock = new ActiveTabLock({ onTakenOver, onHandedOver });
		created.push(lock);
		return { lock, onTakenOver, onHandedOver };
	}

	async function startActiveTab(options: Parameters<typeof createTab>[0] = {}) {
		const tab = createTab(options);
		tab.lock.start();
		await vi.waitFor(() => expect(tab.lock.getSnapshot().state).toBe('active'));
		return tab;
	}

	function startPassiveTab(options: Parameters<typeof createTab>[0] = {}) {
		const tab = createTab(options);
		tab.lock.start({ passive: true });
		return tab;
	}

	// Holds the lock without ever answering a take-over, like a hung tab.
	function holdLockForever(): void {
		locks.request(LOCK_NAME, {}, () => new Promise(() => {})).catch(() => {});
	}

	beforeEach(() => {
		locks = new FakeLockManager();
		vi.stubGlobal('navigator', { locks });
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
	});

	afterEach(() => {
		for (const lock of created.splice(0)) {
			lock.dispose();
		}
		FakeBroadcastChannel.open.clear();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	describe('start', () => {
		it('starts pending', () => {
			const { lock } = createTab();

			expect(lock.getSnapshot().state).toBe('pending');
		});

		it('becomes active when no other tab is', async () => {
			const { lock } = createTab();

			lock.start();

			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('active'));
		});

		it('becomes inactive when another tab is active', async () => {
			await startActiveTab();
			const { lock } = createTab();

			lock.start();

			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('inactive'), { timeout: 2_000 });
			expect(locks.queue).toHaveLength(0);
		});

		it('becomes active when the other tab goes away while waiting', async () => {
			const first = await startActiveTab();
			const { lock } = createTab();

			lock.start();
			first.lock.dispose();

			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('active'));
		});

		it('stays inactive without requesting the lock when passive', async () => {
			const request = vi.spyOn(locks, 'request');
			const { lock } = createTab();

			lock.start({ passive: true });
			await tick();

			expect(lock.getSnapshot().state).toBe('inactive');
			expect(request).not.toHaveBeenCalled();
		});

		it('is always active without Web Locks', () => {
			vi.stubGlobal('navigator', {});
			const { lock } = createTab();

			lock.start();

			expect(lock.getSnapshot().state).toBe('active');
		});
	});

	describe('takeOver', () => {
		it('does nothing when already active', async () => {
			const { lock } = await startActiveTab();
			const other = startPassiveTab();
			const request = vi.spyOn(locks, 'request');

			await lock.takeOver();

			expect(lock.getSnapshot().state).toBe('active');
			expect(request).not.toHaveBeenCalled();
			expect(other.onHandedOver).not.toHaveBeenCalled();
		});

		it('takes a free lock without asking anyone', async () => {
			const other = startPassiveTab();
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(lock.getSnapshot().state).toBe('active');
			expect(onHandedOver).not.toHaveBeenCalled();
			expect(other.onTakenOver).not.toHaveBeenCalled();
		});

		it('gets the session from the active tab', async () => {
			const session = { userHandle: 'user', mainKey: 'key' };
			const active = await startActiveTab({ onTakenOver: vi.fn<OnTakenOver>(() => session) });
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(active.onTakenOver).toHaveBeenCalledOnce();
			expect(active.lock.getSnapshot().state).toBe('inactive');
			expect(onHandedOver).toHaveBeenCalledWith(session);
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('waits for an async onTakenOver', async () => {
			const active = await startActiveTab({
				onTakenOver: vi.fn<OnTakenOver>(async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { userHandle: 'user' };
				}),
			});
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(active.onTakenOver).toHaveBeenCalledOnce();
			expect(onHandedOver).toHaveBeenCalledWith({ userHandle: 'user' });
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('writes the session before becoming active', async () => {
			await startActiveTab({ onTakenOver: vi.fn<OnTakenOver>(() => ({ userHandle: 'user' })) });
			let stateAtHandOver: string | undefined;
			const { lock } = startPassiveTab({
				onHandedOver: vi.fn<OnHandedOver>(() => {
					stateAtHandOver = lock.getSnapshot().state;
				}),
			});

			await lock.takeOver();

			expect(stateAtHandOver).toBe('inactive');
		});

		it('takes over without a session when the active tab has none', async () => {
			await startActiveTab();
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(onHandedOver).not.toHaveBeenCalled();
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('takes over when onTakenOver throws in the active tab', async () => {
			const active = await startActiveTab({
				onTakenOver: vi.fn<OnTakenOver>(() => {
					throw new Error('boom');
				}),
			});
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(active.lock.getSnapshot().state).toBe('inactive');
			expect(onHandedOver).not.toHaveBeenCalled();
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('hands the session only to the tab that asked', async () => {
			await startActiveTab({ onTakenOver: vi.fn<OnTakenOver>(() => ({ userHandle: 'user' })) });
			const bystander = startPassiveTab();
			const { lock, onHandedOver } = startPassiveTab();

			await lock.takeOver();

			expect(onHandedOver).toHaveBeenCalledOnce();
			expect(bystander.onHandedOver).not.toHaveBeenCalled();
			expect(bystander.lock.getSnapshot().state).toBe('inactive');
		});

		it('ignores take-over messages while inactive', async () => {
			await startActiveTab();
			const bystander = startPassiveTab();
			const { lock } = startPassiveTab();

			await lock.takeOver();

			expect(bystander.onTakenOver).not.toHaveBeenCalled();
		});

		it('steals the lock when the active tab does not answer', async () => {
			holdLockForever();
			const { lock, onHandedOver } = startPassiveTab();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

			const takingOver = lock.takeOver();
			await vi.advanceTimersByTimeAsync(5_000);
			await takingOver;

			expect(onHandedOver).not.toHaveBeenCalled();
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('does not steal its own lock when take-over is called twice', async () => {
			holdLockForever();
			const { lock, onTakenOver } = startPassiveTab();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

			const first = lock.takeOver();
			const second = lock.takeOver();
			await vi.advanceTimersByTimeAsync(10_000);
			await Promise.all([first, second]);

			expect(onTakenOver).not.toHaveBeenCalled();
			expect(lock.getSnapshot().state).toBe('active');
		});

		it('lets the previous tab take back over', async () => {
			const first = await startActiveTab({ onTakenOver: vi.fn<OnTakenOver>(() => ({ userHandle: 'a' })) });
			const second = startPassiveTab({ onTakenOver: vi.fn<OnTakenOver>(() => ({ userHandle: 'b' })) });

			await second.lock.takeOver();
			await first.lock.takeOver();

			expect(first.lock.getSnapshot().state).toBe('active');
			expect(second.lock.getSnapshot().state).toBe('inactive');
			expect(first.onHandedOver).toHaveBeenCalledWith({ userHandle: 'b' });
		});
	});

	describe('when the lock is stolen', () => {
		it('becomes inactive and stops', async () => {
			const { lock, onTakenOver } = await startActiveTab();

			locks.request(LOCK_NAME, { steal: true }, () => new Promise(() => {}));

			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('inactive'));
			expect(onTakenOver).toHaveBeenCalledOnce();
		});
	});

	describe('subscribe', () => {
		it('notifies on state changes until unsubscribed', async () => {
			const { lock } = createTab();
			const listener = vi.fn();
			const unsubscribe = lock.subscribe(listener);

			lock.start();
			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('active'));
			expect(listener).toHaveBeenCalledOnce();

			unsubscribe();
			locks.request(LOCK_NAME, { steal: true }, () => new Promise(() => {}));
			await vi.waitFor(() => expect(lock.getSnapshot().state).toBe('inactive'));
			expect(listener).toHaveBeenCalledOnce();
		});

		it('keeps the same snapshot while the state does not change', async () => {
			const { lock } = await startActiveTab();
			const snapshot = lock.getSnapshot();

			await lock.takeOver();

			expect(lock.getSnapshot()).toBe(snapshot);
		});
	});

	describe('dispose', () => {
		it('releases the lock', async () => {
			const first = await startActiveTab();
			const { lock, onHandedOver } = startPassiveTab();

			first.lock.dispose();
			await tick();
			await lock.takeOver();

			expect(lock.getSnapshot().state).toBe('active');
			expect(onHandedOver).not.toHaveBeenCalled();
		});

		it('stops answering take-over requests', async () => {
			const first = await startActiveTab();
			first.lock.dispose();
			await tick();
			const { lock } = startPassiveTab();

			await lock.takeOver();

			expect(first.onTakenOver).not.toHaveBeenCalled();
		});
	});
});
