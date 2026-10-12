import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { compareBy } from '@/lib/utils';
import type { WalletState, WalletStateCredential } from '@/services/WalletStateSchemaVersion3';

// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
export async function getLeastUsedCredentialInstance(
	batchId: number,
	cList: ExtendedVcEntity[],
	walletState: WalletState,
): Promise<WalletStateCredential | null> {
	const credByBatchId = cList.filter((c) => c.batchId === batchId)[0];
	const instances = credByBatchId.instances;
	instances.sort(compareBy((c) => c.sigCount));
	const leastUsedInstance = instances[0];
	const { instanceId } = leastUsedInstance;
	const credential = walletState.credentials.filter(
		(c) => c.batchId === batchId && c.instanceId === instanceId,
	)[0];
	if (!credential) {
		return null;
	}
	return credential;
}
