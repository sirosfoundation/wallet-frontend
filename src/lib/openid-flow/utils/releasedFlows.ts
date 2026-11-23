/**
 * Flows the wallet released locally (the user left, or the call failed).
 * An engine callback that arrives for one of them late is refused, so it
 * can neither sign for it nor be attributed to another live flow. Bounded:
 * only the most recent ids are kept.
 */
export class ReleasedFlows {
	private readonly ids = new Set<string>();

	constructor(private readonly max = 64) {}

	add(flowId: string): void {
		this.ids.delete(flowId);
		this.ids.add(flowId);
		while (this.ids.size > this.max) {
			const oldest = this.ids.values().next().value;
			if (oldest === undefined) break;
			this.ids.delete(oldest);
		}
	}

	/** A flow resumed under the same id (after an authorization redirect) is live again. */
	delete(flowId: string): void {
		this.ids.delete(flowId);
	}

	has(flowId: string | undefined): boolean {
		return flowId !== undefined && this.ids.has(flowId);
	}
}