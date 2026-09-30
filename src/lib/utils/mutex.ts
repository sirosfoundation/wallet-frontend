/**
 * A simple mutex for ensuring exclusive access to
 * asynchronous tasks.
 */
export class Mutex {
	#tail: Promise<void> = Promise.resolve();

	/**
	 * Runs the given task exclusively,
	 * ensuring that no other tasks are running concurrently.
	 *
	 * @param task The asynchronous task to run exclusively.
	 */
	async runExclusive<T>(task: () => Promise<T>): Promise<T> {
		const previous = this.#tail;

		let release: () => void;
		this.#tail = new Promise<void>((resolve) => {
			release = resolve;
		});

		await previous;
		try {
			return await task();
		} finally {
			release!();
		}
	}
}
