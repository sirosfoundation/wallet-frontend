/**
 * Creates a deferred promise with exposed resolve and reject functions.
 * @template T The type of the value that the promise will resolve with.
 */
export function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}
