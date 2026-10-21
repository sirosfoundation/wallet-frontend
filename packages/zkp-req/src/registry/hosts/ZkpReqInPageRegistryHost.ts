import { ZkpReqHostPriority, ZkpReqRegistryHosts } from '../../resources';
import { ZkpReqSelection, ZkpReqSelectionCriteria, IZkpReqRegistryHost } from '../../types';

export class ZkpReqInPageRegistryHost implements IZkpReqRegistryHost {
	readonly id = ZkpReqRegistryHosts.IN_PAGE;
	readonly priority = ZkpReqHostPriority.IN_PAGE;

	async initialize(): Promise<void> {
		return Promise.resolve();
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async selectSystem(criteria: ZkpReqSelectionCriteria): Promise<ZkpReqSelection | null> {
		return Promise.resolve(null);
	}
}
