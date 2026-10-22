import { describe, it, expect } from 'vitest';
import { createDeferred } from './createDeferred';

describe('createDeferred', () => {
	it('should create a deferred promise that can be resolved', async () => {
		const { promise, resolve } = createDeferred<number>();
		setTimeout(() => resolve(42), 100);
		const result = await promise;
		expect(result).toBe(42);
	});

	it('should create a deferred promise that can be rejected', async () => {
		const { promise, reject } = createDeferred<number>();
		setTimeout(() => reject(new Error('fail')), 100);
		await expect(promise).rejects.toThrow('fail');
	});
});
