import { ReissueNotice } from './resources';

export function sameNotices(
	a: ReadonlyMap<number, ReissueNotice>,
	b: ReadonlyMap<number, ReissueNotice>,
): boolean {
	if (a.size !== b.size) return false;

	for (const [batchId, notice] of a) {
			if (b.get(batchId) !== notice) return false;
	}

	return true;
}
