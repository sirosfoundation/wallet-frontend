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

type TakeOverAttempt = {
	promise: Promise<void>;
	controller: AbortController;
};

const LOCK_NAME = 'wallet-active-tab';
const TAKE_OVER_MESSAGE = 'take-over';
const HANDED_OVER_MESSAGE = 'handed-over';
const TAKE_OVER_TIMEOUT = 5_000;
const START_TIMEOUT = 500;

/**
 * Makes sure only one tab uses the wallet at a time.
 */
export class ActiveTabLock {
	readonly #onTakenOver: OnTakenOver;
	readonly #onHandedOver: OnHandedOver;
	readonly #channel = new BroadcastChannel(LOCK_NAME);
	#snapshot: ActiveTabSnapshot = { state: 'pending' };
	#listeners = new Set<() => void>();
	#release?: () => void;
	// Set only while this tab waits for a hand-over it asked for.
	#receiveHandOver?: (message: ActiveTabMessage) => void;
	#disposed = false;
	#takingOver?: TakeOverAttempt;

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

	takeOver(): Promise<void> {
		if (this.#takingOver) {
			return this.#waitOrSteal(this.#takingOver);
		}

		return this.#startTakeOver((signal) => this.#takeOver(signal));
	}

	#startTakeOver(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
		const controller = new AbortController();
		const promise = (async () => {
			try {
				await run(controller.signal);
			} finally {
				if (this.#takingOver?.promise === promise) {
					this.#takingOver = undefined;
				}
			}
		})();

		this.#takingOver = { promise, controller };
		return promise;
	}

	/**
	 * Wait for a take-over that is already running, and steal the lock if it
	 * has not made this tab active in time.
	 */
	async #waitOrSteal(attempt: TakeOverAttempt): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled([attempt.promise]),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, TAKE_OVER_TIMEOUT);
			}),
		]);
		clearTimeout(timer);

		if (this.#snapshot.state === 'active') {
			return;
		}

		// It settled without the lock, or another call already replaced it.
		if (this.#takingOver !== attempt) {
			return this.takeOver();
		}

		// Cancel first, so the old attempt cannot take the lock this one steals.
		attempt.controller.abort();
		await this.#startTakeOver(async (signal) => {
			logger.warn('The take-over did not finish in time; taking over anyway');
			await this.#request({ steal: true }, signal);
		});
	}

	/**
	 * Ask the active tab to hand over its session, and take the lock anyway if
	 * it does not answer in time.
	 */
	async #takeOver(signal: AbortSignal): Promise<void> {
		if (this.#snapshot.state === 'active') {
			return;
		}

		// No active tab at all, so there is nothing to hand over.
		if ((await this.#request({ ifAvailable: true }, signal)) || signal.aborted) {
			return;
		}

		const handedOver = this.#waitForHandOver(signal);
		this.#channel.postMessage({
			type: TAKE_OVER_MESSAGE,
		} satisfies ActiveTabMessage);
		const message = await handedOver;
		if (signal.aborted) {
			return;
		}

		if (!message) {
			logger.warn(
				'The active tab did not hand over in time; taking over anyway',
			);
			await this.#request({ steal: true }, signal);
			return;
		}

		// Before the lock, so the session is in place when the app mounts.
		if (message.type === HANDED_OVER_MESSAGE && message.session) {
			this.#onHandedOver(message.session);
		}

		try {
			await this.#request(
				{
					signal: AbortSignal.any([
						signal,
						AbortSignal.timeout(TAKE_OVER_TIMEOUT),
					]),
				},
				signal,
			);
		} catch (error) {
			if (!signal.aborted) {
				throw error;
			}
		}
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
		this.#takingOver?.controller.abort();
		this.#channel.removeEventListener('message', this.#handleMessage);
		this.#channel.close();
		this.#release?.();
		this.#release = undefined;
		this.#listeners.clear();
	}

	/**
	 * Resolves once the lock request is answered: true if this tab now holds
	 * the lock. The lock is then held until #release is called. A lock granted
	 * after `attempt` is aborted is released right away.
	 */
	#request(options: LockOptions, attempt?: AbortSignal): Promise<boolean> {
		return new Promise(async (granted, notGranted) => {
			let held = false;

			try {
				await navigator.locks.request(LOCK_NAME, options, (lock) => {
					if (attempt?.aborted) {
						granted(false);
						return;
					}

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
	 * arrives in time or `signal` is aborted.
	 */
	#waitForHandOver(signal: AbortSignal): Promise<ActiveTabMessage | null> {
		return new Promise((resolve) => {
			const done = (message: ActiveTabMessage | null) => {
				clearTimeout(timer);
				if (this.#receiveHandOver === done) {
					this.#receiveHandOver = undefined;
				}
				resolve(message);
			};
			const timer = setTimeout(() => done(null), TAKE_OVER_TIMEOUT);
			signal.addEventListener('abort', () => done(null), { once: true });
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
