import { describe, it, expect, vi } from 'vitest';
import { Mutex } from './mutex';

/**
 * Resolves after the given number of milliseconds.
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Mutex', () => {
	it('returns the value produced by the task', async () => {
		const mutex = new Mutex();

		const result = await mutex.runExclusive(async () => 42);

		expect(result).toBe(42);
	});

	it('runs tasks one at a time, never overlapping', async () => {
		const mutex = new Mutex();
		let active = 0;
		let maxActive = 0;

		const task = () =>
			mutex.runExclusive(async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await delay(5);
				active--;
			});

		await Promise.all([task(), task(), task()]);

		expect(maxActive).toBe(1);
		expect(active).toBe(0);
	});

	it('preserves submission order (FIFO)', async () => {
		const mutex = new Mutex();
		const order: number[] = [];

		const tasks = [1, 2, 3].map((n) =>
			mutex.runExclusive(async () => {
				order.push(n);
			}),
		);

		await Promise.all(tasks);

		expect(order).toEqual([1, 2, 3]);
	});

	it('releases the lock after a task throws, allowing later tasks to run', async () => {
		const mutex = new Mutex();
		const error = new Error('boom');

		await expect(
			mutex.runExclusive(async () => {
				throw error;
			}),
		).rejects.toThrow(error);

		const result = await mutex.runExclusive(async () => 'recovered');

		expect(result).toBe('recovered');
	});

	it('waits for the previous task to finish before starting the next', async () => {
		const mutex = new Mutex();
		const events: string[] = [];

		const first = mutex.runExclusive(async () => {
			events.push('first:start');
			await delay(10);
			events.push('first:end');
		});

		const second = mutex.runExclusive(async () => {
			events.push('second:start');
		});

		await Promise.all([first, second]);

		expect(events).toEqual([
			'first:start',
			'first:end',
			'second:start',
		]);
	});

	it('supports concurrent, independent mutex instances', async () => {
		const a = new Mutex();
		const b = new Mutex();
		const fn = vi.fn(async () => 'done');

		const [ra, rb] = await Promise.all([
			a.runExclusive(fn),
			b.runExclusive(fn),
		]);

		expect(ra).toBe('done');
		expect(rb).toBe('done');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
