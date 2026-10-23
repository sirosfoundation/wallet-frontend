import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { AxiosResponse } from 'axios';
import { Err, Ok } from 'ts-results';

import { PrivateDataCoordinator, PrivateDataMerger, PrivateDataTransport } from './privateDataSync';
import type { EncryptedContainer } from '../services/keystore';
import type { CachedUser } from '../services/LocalStorageKeystore';

const conflict = () => Promise.reject({ cause: 'x-private-data-etag' });

const container = (id: string) => ({ id } as unknown as EncryptedContainer);

const remote = (etag = '"remote"'): AxiosResponse => ({
	status: 200,
	data: { privateData: new Uint8Array([1]) },
	headers: { 'x-private-data-etag': etag },
} as unknown as AxiosResponse);

const notModified = (): AxiosResponse => ({ status: 304, data: '', headers: {} } as unknown as AxiosResponse);

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

const cachedUser = { userHandleB64u: 'u1' } as CachedUser;

let transport: {
	isOnline: boolean;
	fetchRemote: Mock<PrivateDataTransport['fetchRemote']>;
	save: Mock<PrivateDataTransport['save']>;
	onSyncFail: Mock<PrivateDataTransport['onSyncFail']>;
};
let mergeCommit: ReturnType<typeof vi.fn>;
let merger: PrivateDataMerger & { syncWithRemoteData: ReturnType<typeof vi.fn> };
let coordinator: PrivateDataCoordinator;

beforeEach(() => {
	transport = {
		isOnline: true,
		fetchRemote: vi.fn(async () => remote()),
		save: vi.fn(async () => { }),
		onSyncFail: vi.fn(),
	};
	mergeCommit = vi.fn(async () => { });
	merger = {
		syncWithRemoteData: vi.fn(async () => Ok([container('merged'), mergeCommit] as const)),
	} as unknown as typeof merger;
	coordinator = new PrivateDataCoordinator(3);
});

describe('PrivateDataCoordinator.sync', () => {
	it('returns Ok without merging when remote is unchanged (304)', async () => {
		transport.fetchRemote.mockResolvedValueOnce(notModified());

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.ok).toBe(true);
		expect(merger.syncWithRemoteData).not.toHaveBeenCalled();
		expect(transport.save).not.toHaveBeenCalled();
	});

	it('does nothing while offline', async () => {
		transport.isOnline = false;

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.ok).toBe(true);
		expect(transport.fetchRemote).not.toHaveBeenCalled();
	});

	it('merges, POSTs with the remote etag, then commits', async () => {
		const order: string[] = [];
		transport.save.mockImplementation(async () => { order.push('save'); });
		mergeCommit.mockImplementation(async () => { order.push('commit'); });

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.ok).toBe(true);
		expect(transport.save).toHaveBeenCalledWith(container('merged'), '"remote"');
		expect(order).toEqual(['save', 'commit']);
		expect(transport.onSyncFail).not.toHaveBeenCalled();
	});

	it('shares a single in-flight sync between concurrent callers (one GET)', async () => {
		const gate = deferred<AxiosResponse>();
		transport.fetchRemote.mockReturnValueOnce(gate.promise);

		const a = coordinator.sync(transport, cachedUser, merger);
		const b = coordinator.sync(transport, cachedUser, merger);
		expect(b).toBe(a);

		gate.resolve(notModified());
		await Promise.all([a, b]);

		expect(transport.fetchRemote).toHaveBeenCalledTimes(1);
	});

	it('starts a new sync once the previous one finished', async () => {
		transport.fetchRemote.mockResolvedValue(notModified());

		await coordinator.sync(transport, cachedUser, merger);
		await coordinator.sync(transport, cachedUser, merger);

		expect(transport.fetchRemote).toHaveBeenCalledTimes(2);
	});

	it('retries GET → merge → POST on a 412 from the merge POST, without committing the stale merge', async () => {
		transport.save.mockImplementationOnce(conflict);

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.ok).toBe(true);
		expect(transport.fetchRemote).toHaveBeenCalledTimes(2);
		expect(merger.syncWithRemoteData).toHaveBeenCalledTimes(2);
		expect(transport.save).toHaveBeenCalledTimes(2);
		expect(mergeCommit).toHaveBeenCalledTimes(1);
		expect(transport.onSyncFail).not.toHaveBeenCalled();
	});

	it('gives up after max attempts with a conflict error and does NOT trigger re-auth', async () => {
		transport.save.mockImplementation(conflict);

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.err && r.val).toBe('x-private-data-etag');
		expect(transport.save).toHaveBeenCalledTimes(3);
		expect(mergeCommit).not.toHaveBeenCalled();
		expect(transport.onSyncFail).not.toHaveBeenCalled();
	});

	it('triggers re-auth (?sync=fail) only when the remote copy cannot be merged', async () => {
		merger.syncWithRemoteData.mockResolvedValueOnce(Err('mergeFailed'));

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.err && r.val).toBe('syncFailed');
		expect(transport.onSyncFail).toHaveBeenCalledWith(cachedUser);
		expect(transport.save).not.toHaveBeenCalled();
	});

	it('triggers re-auth when remote changed and no keystore is available', async () => {
		const r = await coordinator.sync(transport, cachedUser);

		expect(r.err && r.val).toBe('syncFailed');
		expect(transport.onSyncFail).toHaveBeenCalledWith(cachedUser);
	});

	it('does not trigger re-auth on a network error', async () => {
		transport.fetchRemote.mockRejectedValueOnce(new Error('network'));

		const r = await coordinator.sync(transport, cachedUser, merger);

		expect(r.err && r.val).toBe('syncFailed');
		expect(transport.onSyncFail).not.toHaveBeenCalled();
	});
});

describe('PrivateDataCoordinator.edit', () => {
	it('runs edit → save → commit in order and returns the edit result', async () => {
		const order: string[] = [];
		const commit = vi.fn(async () => { order.push('commit'); });
		transport.save.mockImplementation(async () => { order.push('save'); });

		const result = await coordinator.edit(transport, async () => {
			order.push('edit');
			return ['result', container('edited'), commit];
		});

		expect(result).toBe('result');
		expect(order).toEqual(['edit', 'save', 'commit']);
		expect(transport.save).toHaveBeenCalledWith(container('edited'));
	});

	it('on 412: merges remote, re-runs the edit on the merged state, and commits only the successful attempt', async () => {
		const commits = [vi.fn(async () => { }), vi.fn(async () => { })];
		let n = 0;
		const edit = vi.fn(async () => {
			const i = n++;
			return [i, container(`edited-${i}`), commits[i]] as [number, EncryptedContainer, () => Promise<void>];
		});
		transport.save
			.mockImplementationOnce(conflict) // edit #1 POST
			.mockImplementationOnce(async () => { }) // merge POST
			.mockImplementationOnce(async () => { }); // edit #2 POST

		const result = await coordinator.edit(transport, edit, { keystore: merger, cachedUser });

		expect(result).toBe(1);
		expect(edit).toHaveBeenCalledTimes(2);
		expect(mergeCommit).toHaveBeenCalledTimes(1);
		expect(commits[0]).not.toHaveBeenCalled();
		expect(commits[1]).toHaveBeenCalledTimes(1);
		expect(transport.save).toHaveBeenNthCalledWith(3, container('edited-1'));
	});

	it('on 412 without a keystore: rejects with a conflict and never commits', async () => {
		const commit = vi.fn(async () => { });
		transport.save.mockImplementation(conflict);

		await expect(
			coordinator.edit(transport, async () => [{}, container('edited'), commit]),
		).rejects.toMatchObject({ cause: 'x-private-data-etag' });

		expect(commit).not.toHaveBeenCalled();
		expect(transport.fetchRemote).not.toHaveBeenCalled();
	});

	it('rejects without committing when the merge needs re-auth', async () => {
		const commit = vi.fn(async () => { });
		transport.save.mockImplementationOnce(conflict);
		merger.syncWithRemoteData.mockResolvedValueOnce(Err('mergeFailed'));

		await expect(
			coordinator.edit(transport, async () => [{}, container('edited'), commit], { keystore: merger, cachedUser }),
		).rejects.toMatchObject({ cause: 'x-private-data-etag' });

		expect(commit).not.toHaveBeenCalled();
		expect(transport.onSyncFail).toHaveBeenCalledWith(cachedUser);
	});

	it('propagates non-conflict save errors without committing', async () => {
		const commit = vi.fn(async () => { });
		transport.save.mockRejectedValueOnce(new Error('boom'));

		await expect(
			coordinator.edit(transport, async () => [{}, container('edited'), commit], { keystore: merger }),
		).rejects.toThrow('boom');

		expect(commit).not.toHaveBeenCalled();
	});
});

describe('PrivateDataCoordinator serialization', () => {
	it('a sync started during an edit waits until the edit has committed', async () => {
		const order: string[] = [];
		const saveGate = deferred<void>();
		transport.save.mockImplementationOnce(async () => {
			order.push('edit:save:start');
			await saveGate.promise;
			order.push('edit:save:end');
		});
		transport.fetchRemote.mockImplementation(async () => {
			order.push('sync:get');
			return notModified();
		});

		const editPromise = coordinator.edit(transport, async () => [
			{},
			container('edited'),
			async () => { order.push('edit:commit'); },
		]);
		// let the edit reach save()
		await vi.waitFor(() => expect(order).toContain('edit:save:start'));

		const syncPromise = coordinator.sync(transport, cachedUser, merger);
		await Promise.resolve();
		expect(transport.fetchRemote).not.toHaveBeenCalled();

		saveGate.resolve();
		await Promise.all([editPromise, syncPromise]);

		expect(order).toEqual(['edit:save:start', 'edit:save:end', 'edit:commit', 'sync:get']);
	});

	it('an edit started during a sync waits until the sync has committed', async () => {
		const order: string[] = [];
		const getGate = deferred<AxiosResponse>();
		transport.fetchRemote.mockImplementationOnce(async () => {
			order.push('sync:get');
			return getGate.promise;
		});
		mergeCommit.mockImplementation(async () => { order.push('sync:commit'); });

		const syncPromise = coordinator.sync(transport, cachedUser, merger);
		await vi.waitFor(() => expect(order).toContain('sync:get'));

		const edit = vi.fn(async () => {
			order.push('edit:run');
			return [{}, container('edited'), async () => { order.push('edit:commit'); }] as [object, EncryptedContainer, () => Promise<void>];
		});
		const editPromise = coordinator.edit(transport, edit);
		await Promise.resolve();
		expect(edit).not.toHaveBeenCalled();

		getGate.resolve(remote());
		await Promise.all([syncPromise, editPromise]);

		expect(order).toEqual(['sync:get', 'sync:commit', 'edit:run', 'edit:commit']);
	});

	it('edit() with a custom save uses it instead of transport.save, and retries it after a merge', async () => {
		const customSave = vi.fn<(c: EncryptedContainer) => Promise<void>>()
			.mockImplementationOnce(conflict)
			.mockImplementationOnce(async () => { });
		const commit = vi.fn(async () => { });
		let n = 0;
		const edit = vi.fn(async () => [{}, container(`edited-${n++}`), commit] as [object, EncryptedContainer, () => Promise<void>]);

		await coordinator.edit(transport, edit, { keystore: merger, cachedUser, save: customSave });

		expect(customSave).toHaveBeenNthCalledWith(1, container('edited-0'));
		expect(customSave).toHaveBeenNthCalledWith(2, container('edited-1'));
		// only the merge POST goes through transport.save
		expect(transport.save).toHaveBeenCalledTimes(1);
		expect(transport.save).toHaveBeenCalledWith(container('merged'), '"remote"');
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it('an edit queued behind another edit reads state only after the first one committed', async () => {
		// Models a legacy writer (e.g. PRF upgrade) racing a regular edit: the
		// second edit must build its container from the state the first committed.
		let state = 'v0';
		const saveGate = deferred<void>();
		transport.save
			.mockImplementationOnce(async () => { await saveGate.promise; })
			.mockImplementationOnce(async () => { });

		const first = coordinator.edit(transport, async () => {
			const next = `${state}+a`;
			return [{}, container(next), async () => { state = next; }];
		});
		await vi.waitFor(() => expect(transport.save).toHaveBeenCalledTimes(1));

		const secondEdit = vi.fn(async () => {
			const next = `${state}+b`;
			return [{}, container(next), async () => { state = next; }] as [object, EncryptedContainer, () => Promise<void>];
		});
		const second = coordinator.edit(transport, secondEdit);
		await Promise.resolve();
		expect(secondEdit).not.toHaveBeenCalled();

		saveGate.resolve();
		await Promise.all([first, second]);

		expect(transport.save).toHaveBeenNthCalledWith(2, container('v0+a+b'));
		expect(state).toBe('v0+a+b');
	});

	it('exclusive() is serialized with edits and syncs', async () => {
		const order: string[] = [];
		const gate = deferred<void>();

		const ex = coordinator.exclusive(async () => {
			order.push('exclusive:start');
			await gate.promise;
			order.push('exclusive:end');
		});
		transport.fetchRemote.mockImplementation(async () => {
			order.push('sync:get');
			return notModified();
		});
		const sync = coordinator.sync(transport, cachedUser, merger);
		await Promise.resolve();
		expect(transport.fetchRemote).not.toHaveBeenCalled();

		gate.resolve();
		await Promise.all([ex, sync]);
		expect(order).toEqual(['exclusive:start', 'exclusive:end', 'sync:get']);
	});

	it('the lock is released after a failing operation', async () => {
		transport.save.mockRejectedValueOnce(new Error('boom'));
		await expect(
			coordinator.edit(transport, async () => [{}, container('a'), async () => { }]),
		).rejects.toThrow('boom');

		transport.fetchRemote.mockResolvedValueOnce(notModified());
		await expect(coordinator.sync(transport, cachedUser, merger)).resolves.toMatchObject({ ok: true });
	});
});
