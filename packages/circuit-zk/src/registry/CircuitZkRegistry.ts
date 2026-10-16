import { CircuitZkError } from '../resources';
import {
	CircuitZkSelection,
	CircuitZkSelectionCriteria,
	ICircuitZkRegistryHost,
	ICircuitZkRegistry,
} from '../types';
import { CircuitZkDemoRegistryHost } from './hosts/CircuitZkDemoRegistryHost';
import { CircuitZkInPageRegistryHost } from './hosts/CircuitZkInPageRegistryHost';

export class CircuitZkRegistry implements ICircuitZkRegistry {
	#ready: Promise<void>;
	#availableHosts: ICircuitZkRegistryHost[] = [];

	constructor(
		hosts: ICircuitZkRegistryHost[] = [
			new CircuitZkDemoRegistryHost(),
			// new CircuitZkInPageRegistryHost(),
		],
	) {
		this.#ready = this.#initialize(hosts);
	}

	async #initialize(hosts: ICircuitZkRegistryHost[]): Promise<void> {
		await this.#registerHosts(hosts);
	}

	async selectCircuit(
		criteria: CircuitZkSelectionCriteria,
	): Promise<CircuitZkSelection | null> {
		await this.#ready;

		const [host] = [...this.#availableHosts].sort(
			(a, b) => b.priority - a.priority,
		);
		if (!host) {
			throw new CircuitZkError(
				'access_denied',
				'No circuit registry host available',
			);
		}

		return host.selectCircuit(criteria);
	}

	async dispose(): Promise<void> {
		await Promise.all(this.#availableHosts.map((host) => host.dispose?.()));
	}

	async #registerHosts(hosts: ICircuitZkRegistryHost[]): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize()));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable()),
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}
}
