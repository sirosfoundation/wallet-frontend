import { describe, expect, it } from 'vitest';
import { TokenStatus } from '@sirosfoundation/token-status-list';
import type { ExtendedVcEntity, Instance } from '@/context/CredentialsContext';
import type { WalletState } from '@/services/WalletStateSchemaVersion3';
import { getLeastUsedCredentialInstance } from './CredentialBatchHelper';

const BATCH = 7;

describe('getLeastUsedCredentialInstance', () => {
	it('picks the least used instance', async () => {
		const { cList, walletState } = batch([
			{ sigCount: 2 },
			{ sigCount: 0 },
			{ sigCount: 1 },
		]);

		const credential = await getLeastUsedCredentialInstance(
			BATCH,
			cList,
			walletState,
		);

		expect(credential?.instanceId).toBe(1);
	});

	it('skips revoked, suspended and rejected instances', async () => {
		const { cList, walletState } = batch([
			{ sigCount: 0, status: TokenStatus.INVALID },
			{ sigCount: 0, status: TokenStatus.SUSPENDED },
			{ sigCount: 0, status: TokenStatus.REJECTED },
			{ sigCount: 3, status: TokenStatus.VALID },
		]);

		const credential = await getLeastUsedCredentialInstance(
			BATCH,
			cList,
			walletState,
		);

		expect(credential?.instanceId).toBe(3);
	});

	it('returns null when every instance is blocked', async () => {
		const { cList, walletState } = batch([
			{ sigCount: 0, status: TokenStatus.INVALID },
			{ sigCount: 1, status: TokenStatus.SUSPENDED },
		]);

		expect(
			await getLeastUsedCredentialInstance(BATCH, cList, walletState),
		).toBeNull();
	});

	it('returns null for an unknown batch', async () => {
		const { cList, walletState } = batch([{ sigCount: 0 }]);

		expect(
			await getLeastUsedCredentialInstance(BATCH + 1, cList, walletState),
		).toBeNull();
	});
});

function batch(instances: Partial<Instance>[]) {
	const full: Instance[] = instances.map((instance, instanceId) => ({
		credentialId: 100 + instanceId,
		instanceId,
		sigCount: 0,
		...instance,
	}));

	const cList = [
		{ batchId: BATCH, instances: full },
	] as unknown as ExtendedVcEntity[];
	const walletState = {
		credentials: full.map(({ credentialId, instanceId }) => ({
			credentialId,
			instanceId,
			batchId: BATCH,
		})),
	} as unknown as WalletState;

	return { cList, walletState };
}
