import {
	CircuitZkError,
	CircuitZkHostPriority,
	CircuitZkRegistryHosts,
} from '../../resources';
import type {
	CircuitZkSelection,
	CircuitZkSelectionCriteria,
	ICircuitZkRegistryHost,
} from '../../types';

/**
 * @todo Decide on the exact API and payload structure for the
 *       native wrapper bridge.
 *       When done, put the finalized type in src/lib/native-wrapper/types.ts
 */
declare global {
	interface Window {
		nativeWrapper?: {
			callCircuitRegistry: (
				method: string,
				payload: unknown,
			) => Promise<unknown>;
		};
	}
}

/**
 * Delegates circuit selection to the wrapper app /
 * siros-sdk-kotlin, which owns the catalogue and matching.
 *
 * This mirrors the behavior of the WSCD Manager Native Wrapper Host.
 *
 * @todo The bridge method name and payload shape are placeholders.
 */
export class CircuitZkNativeWrapperRegistryHost implements ICircuitZkRegistryHost {
	readonly id = CircuitZkRegistryHosts.NATIVE_WRAPPER;
	readonly priority = CircuitZkHostPriority.NATIVE_WRAPPER;

	async initialize(): Promise<void> {
		// no-op
	}

	async isAvailable(): Promise<boolean> {
		return typeof window.nativeWrapper?.callCircuitRegistry === 'function';
	}

	async selectCircuit(
		criteria: CircuitZkSelectionCriteria,
	): Promise<CircuitZkSelection | null> {
		const bridge = window.nativeWrapper;
		if (!bridge) {
			throw new CircuitZkError(
				'access_denied',
				'Native wrapper bridge is not available',
			);
		}

		const result = await bridge.callCircuitRegistry('selectCircuit', criteria);

		if (result === null) return null;

		if (!this.#isSelection(result)) {
			throw new CircuitZkError(
				'access_denied',
				'Invalid circuit selection returned from native wrapper',
			);
		}

		return result;
	}

	/**
	 * Checks if the given value conforms to the CircuitZkSelection type.
	 */
	#isSelection(value: unknown): value is CircuitZkSelection {
		if (typeof value !== 'object' || value === null) return false;
		const s = value as Partial<CircuitZkSelection>;
		return (
			typeof s.circuitId === 'string' &&
			typeof s.proofSystem === 'string' &&
			typeof s.proofSystemVersion === 'string'
		);
	}
}
