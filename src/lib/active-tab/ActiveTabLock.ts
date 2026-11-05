import { logger } from '@/logger';

export type ActiveTabState = 'pending' | 'active' | 'inactive';

export type ActiveTabSnapshot = { state: ActiveTabState };

/**
 * Session values handed from the active tab to the tab taking over.
 */
export type HandOverSession = Record<string, string>;

/**
 * Called in the active tab when another tab takes over. Must stop everything
 * that talks to the backend, and returns the session to hand over. The lock
 * is released once it resolves.
 */
export type OnTakenOver = () =>
	Promise<HandOverSession | undefined> | HandOverSession | undefined;

/**
 * Called in the tab taking over with the handed-over session, before the lock
 * is taken.
 */
export type OnHandedOver = (session: HandOverSession) => void;

type ActiveTabMessage =
	| { type: typeof TAKE_OVER_MESSAGE }
	| { type: typeof HANDED_OVER_MESSAGE; session?: HandOverSession };

const LOCK_NAME = 'wallet-active-tab';
const TAKE_OVER_MESSAGE = 'take-over';
const HANDED_OVER_MESSAGE = 'handed-over';
const TAKE_OVER_TIMEOUT = 5_000;
const START_TIMEOUT = 500;

/**
 * Makes sure only one tab uses the wallet at a time.
 */
export class ActiveTabLock {
	#onTakenOver: OnTakenOver;
	#onHandedOver: OnHandedOver;
	#channel = new BroadcastChannel(LOCK_NAME);
	#snapshot: ActiveTabSnapshot = { state: 'pending' };
	#listeners = new Set<() => void>();
	#release?: () => void;
	// Set only while this tab waits for a hand-over it asked for.
	#receiveHandOver?: (message: ActiveTabMessage) => void;
	#disposed = false;

	constructor({
		onTakenOver,
		onHandedOver,
	}: {
		onTakenOver: OnTakenOver;
		onHandedOver: OnHandedOver;
	}) {
		this.#onTakenOver = onTakenOver;
		this.#onHandedOver = onHandedOver;
	}

	/**
	 * Become the active tab if no other tab is. A passive start stays inactive
	 * until takeOver() is called.
	 */
	start({ passive = false }: { passive?: boolean } = {}): void {
		if (!navigator.locks) {
			logger.warn(
				'Web Locks are not available; not limiting the wallet to one tab',
			);
			this.#setState('active');
			return;
		}

		this.#channel.addEventListener('message', this.#handleMessage);
		if (passive) {
			this.#setState('inactive');
			return;
		}

		void (async () => {
			try {
				await this.#request({ signal: AbortSignal.timeout(START_TIMEOUT) });
			} catch (error) {
				if (!(error instanceof DOMException && error.name === 'TimeoutError')) {
					logger.error('Failed to request the active tab lock', error);
				}

				this.#setState('inactive');
			}
		})();
	}

	/**
	 * Ask the active tab to hand over its session, and take the lock anyway if
	 * it does not answer in time.
	 */
	async takeOver(): Promise<void> {
		if (this.#snapshot.state === 'active') {
			return;
		}

		// No active tab at all, so there is nothing to hand over.
		if (await this.#request({ ifAvailable: true })) {
			return;
		}

		const handedOver = this.#waitForHandOver();
		this.#channel.postMessage({
			type: TAKE_OVER_MESSAGE,
		} satisfies ActiveTabMessage);
		const message = await handedOver;

		if (!message) {
			logger.warn(
				'The active tab did not hand over in time; taking over anyway',
			);
			await this.#request({ steal: true });
			return;
		}

		// Before the lock, so the session is in place when the app mounts.
		if (message.type === HANDED_OVER_MESSAGE && message.session) {
			this.#onHandedOver(message.session);
		}
		await this.#request({ signal: AbortSignal.timeout(TAKE_OVER_TIMEOUT) });
	}

	/**
	 * Subscribe to lock state changes.
	 */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Get the current lock state.
	 */
	getSnapshot(): ActiveTabSnapshot {
		return this.#snapshot;
	}

	dispose(): void {
		this.#disposed = true;
		this.#channel.removeEventListener('message', this.#handleMessage);
		this.#channel.close();
		this.#release?.();
		this.#release = undefined;
		this.#listeners.clear();
	}

	/**
	 * Resolves once the lock request is answered: true if this tab now holds
	 * the lock. The lock is then held until #release is called.
	 */
	#request(options: LockOptions): Promise<boolean> {
		return new Promise(async (granted, notGranted) => {
			let held = false;

			try {
				await navigator.locks.request(LOCK_NAME, options, (lock) => {
					if (!lock || this.#disposed) {
						this.#setState('inactive');
						granted(false);
						return;
					}

					held = true;
					this.#setState('active');
					granted(true);

					return new Promise<void>((release) => {
						this.#release = release;
					});
				});
			} catch (err) {
				// Rejecting after the lock was granted means another tab stole it.
				if (held) {
					void this.#handOver();
				} else {
					notGranted(err);
				}
			}
		});
	}

	#handleMessage = (event: MessageEvent<ActiveTabMessage>): void => {
		const message = event.data;

		if (
			message?.type === TAKE_OVER_MESSAGE &&
			this.#snapshot.state === 'active'
		) {
			void this.#handOver();
		} else if (message?.type === HANDED_OVER_MESSAGE) {
			this.#receiveHandOver?.(message);
		}
	};

	async #handOver(): Promise<void> {
		this.#setState('inactive');
		let session: HandOverSession | undefined;
		try {
			session = await this.#onTakenOver();
		} catch (error) {
			logger.error('Failed to stop before handing over the active tab', error);
		} finally {
			// Answer even without a session, so the other tab need not wait for the timeout.
			this.#channel.postMessage({
				type: HANDED_OVER_MESSAGE,
				session,
			} satisfies ActiveTabMessage);
			this.#release?.();
			this.#release = undefined;
		}
	}

	/**
	 * Resolves with the active tab's hand-over message, or null if none
	 * arrives in time.
	 */
	#waitForHandOver(): Promise<ActiveTabMessage | null> {
		return new Promise((resolve) => {
			const done = (message: ActiveTabMessage | null) => {
				clearTimeout(timer);
				this.#receiveHandOver = undefined;
				resolve(message);
			};
			const timer = setTimeout(() => done(null), TAKE_OVER_TIMEOUT);
			this.#receiveHandOver = done;
		});
	}

	#setState(state: ActiveTabState): void {
		if (this.#snapshot.state === state) {
			return;
		}

		logger.debug('Active tab:', state);
		this.#snapshot = { state };
		for (const listener of this.#listeners) {
			listener();
		}
	}
}
