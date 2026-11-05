import { logger } from '@/logger';

/**
 * Run `task` while holding the Web Lock `name`, shared across tabs. If another
 * tab already holds the lock, `task` is skipped instead of queued. Browsers
 * without Web Locks run `task` directly.
 */
export async function withLock(
	name: string,
	task: () => Promise<void>,
): Promise<void> {
	if (!navigator.locks) {
		await task();
		return;
	}

	await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
		if (lock) {
			await task();
		}
	});
}

/**
 * Run `task` while holding the Web Lock `name`, waiting up to `timeout` ms for
 * the current holder. After that the lock is taken from the holder, whose task
 * keeps running. Browsers without Web Locks run `task` directly.
 */
export async function withLockOrSteal<T>(
	name: string,
	task: () => Promise<T>,
	{ timeout }: { timeout: number },
): Promise<T> {
	if (!navigator.locks) {
		return task();
	}

	let started = false;
	try {
		return await navigator.locks.request(name, { signal: AbortSignal.timeout(timeout) }, () => {
			started = true;
			return task();
		});
	} catch (error) {
		if (started || !(error instanceof DOMException && error.name === 'TimeoutError')) {
			throw error;
		}

		logger.warn(`Lock "${name}" still held after ${timeout} ms; taking it`);
		return navigator.locks.request(name, { steal: true }, task);
	}
}
