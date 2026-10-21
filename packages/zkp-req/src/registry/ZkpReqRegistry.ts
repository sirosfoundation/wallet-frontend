import { ZkpReqError } from '../resources';
import {
	ZkpReqSelection,
	ZkpReqSelectionCriteria,
	IZkpReqRegistryHost,
	IZkpReqRegistry,
} from '../types';
import { ZkpReqInPageRegistryHost } from './hosts/ZkpReqInPageRegistryHost';

export class ZkpReqRegistry implements IZkpReqRegistry {
	#ready: Promise<void>;
	#availableHosts: IZkpReqRegistryHost[] = [];

	constructor(
		hosts: IZkpReqRegistryHost[] = [
			new ZkpReqInPageRegistryHost(),
		],
	) {
		this.#ready = this.#initialize(hosts);
	}

	async #initialize(hosts: IZkpReqRegistryHost[]): Promise<void> {
		await this.#registerHosts(hosts);
	}

	async selectSystem(
		criteria: ZkpReqSelectionCriteria,
	): Promise<ZkpReqSelection | null> {
		await this.#ready;

		const [host] = [...this.#availableHosts].sort(
			(a, b) => b.priority - a.priority,
		);
		if (!host) {
			throw new ZkpReqError(
				'access_denied',
				'No system registry host available',
			);
		}

		return host.selectSystem(criteria);
	}

	async dispose(): Promise<void> {
		await Promise.all(this.#availableHosts.map((host) => host.dispose?.()));
	}

	async #registerHosts(hosts: IZkpReqRegistryHost[]): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize()));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable()),
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}
}
