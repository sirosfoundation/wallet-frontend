import { CircuitZkHostPriority, CircuitZkRegistryHosts } from '../../resources';
import { CircuitZkSelection, CircuitZkSelectionCriteria, ICircuitZkRegistryHost } from '../../types';

export class CircuitZkInPageRegistryHost implements ICircuitZkRegistryHost {
	readonly id = CircuitZkRegistryHosts.IN_PAGE;
	readonly priority = CircuitZkHostPriority.IN_PAGE;

	async initialize(): Promise<void> {
		return Promise.resolve();
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async selectCircuit(criteria: CircuitZkSelectionCriteria): Promise<CircuitZkSelection | null> {
		return Promise.resolve(null);
	}
}
