import { WalletState, WalletStateCredential } from "@/services/WalletStateSchemaVersion3";
import { compareBy } from '@/lib/utils';
import { ExtendedVcEntity, Instance } from "@/context/CredentialsContext";
import { TokenStatus } from "@sirosfoundation/token-status-list";

/**
 * Whether the instance can still be presented: unused and not revoked or suspended.
 */
export function isUsableInstance(instance: Pick<Instance, 'sigCount' | 'status'>): boolean {
	return instance.sigCount === 0 && !TokenStatus.isBlocked(instance.status);
}

export async function getLeastUsedCredentialInstance(
	batchId: number,
	cList: ExtendedVcEntity[],
	walletState: WalletState,
): Promise<WalletStateCredential | null> {
	const credByBatchId = cList.filter((c) => c.batchId === batchId)[0];
	if (!credByBatchId) return null;
	const instances = credByBatchId.instances.filter(
		(i) => !TokenStatus.isBlocked(i.status),
	);
	instances.sort(compareBy((c) => c.sigCount));
	const leastUsedInstance = instances[0];
	if (!leastUsedInstance) return null;
	const { instanceId } = leastUsedInstance;
	const credential = walletState.credentials.filter(
		(c) => c.batchId === batchId && c.instanceId === instanceId,
	)[0];
	if (!credential) {
		return null;
	}
	return credential;
}
