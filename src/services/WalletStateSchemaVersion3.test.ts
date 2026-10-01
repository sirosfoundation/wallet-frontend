import { assert, describe, it } from 'vitest';
import { addNewCredentialEvent, CurrentSchema, foldNextEvent, mergeEventHistories } from './WalletStateSchema';

// Merging must carry unknown content (client-defined `S.extensions`, unknown
// event types) instead of dropping or crashing on it.

describe('WalletStateSchemaVersion3 merge tolerance', () => {

	it('carries an unknown event type through a merge instead of throwing', async () => {
		let base = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		base = await addNewCredentialEvent(base, 'cred0', '', '');

		const containerA = await addNewCredentialEvent(base, 'credA', '', '');

		const containerB = await addNewCredentialEvent(base, 'credB', '', '');
		(containerB.events[containerB.events.length - 1] as any).type = 'org.siros.unknown';

		const merged = await mergeEventHistories(containerA, containerB);

		assert(
			merged.events.some((e: any) => e.type === 'org.siros.unknown'),
			'unknown event type should survive the merge',
		);
	});

	it('preserves an unknown top-level S field across a merge', async () => {
		let base = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		base = await addNewCredentialEvent(base, 'cred0', '', '');

		// container1 wins the ancestor tie (passed first, equal lastEventHash),
		// so merged.S comes from it, not from container2 which holds the field.
		const container1 = await addNewCredentialEvent(base, 'cred1', '', '');

		const extensions = { 'org.siros.bbs': { blindingFactor: 'unreconstructable-secret' } };
		let container2 = await addNewCredentialEvent(base, 'cred2', '', '');
		container2 = { ...container2, S: { ...container2.S, extensions } as any }; // distinct S: add* shares the ref

		const merged = await mergeEventHistories(container1, container2);

		assert.deepEqual((merged.S as any).extensions, extensions);
	});

	it('surfaces a handleable outcome when two histories share no common ancestor', async () => {
		// Fold everything so each history has a distinct, non-empty root hash.
		let a = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		a = await addNewCredentialEvent(a, 'onlyA', '', '');
		while (a.events.length > 0) a = await foldNextEvent(a);

		let b = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		b = await addNewCredentialEvent(b, 'onlyB', '', '');
		while (b.events.length > 0) b = await foldNextEvent(b);

		assert.notStrictEqual(a.lastEventHash, b.lastEventHash);

		let threw = false;
		try {
			await mergeEventHistories(a, b);
		} catch {
			threw = true;
		}
		assert(threw, 'no common ancestor should surface a handleable outcome, not corruption');
	});

	it('surfaces the null-merge-base case as a user-resolvable result rather than a generic throw', async () => {
		let a = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		a = await addNewCredentialEvent(a, 'onlyA', '', '');
		while (a.events.length > 0) a = await foldNextEvent(a);

		let b = CurrentSchema.WalletStateOperations.initialWalletStateContainer();
		b = await addNewCredentialEvent(b, 'onlyB', '', '');
		while (b.events.length > 0) b = await foldNextEvent(b);

		let error: unknown;
		try {
			await mergeEventHistories(a, b);
		} catch (e) {
			error = e;
		}
		assert(
			error instanceof CurrentSchema.NoCommonMergeBaseError,
			'no common ancestor should surface a typed, catchable error the caller can resolve',
		);
	});
});
