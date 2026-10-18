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

/** What this host needs from `window.nativeWrapper`. Cast locally so other bridge declarations don't clash. */
interface NativeZkRegistryBridge {
	zkpCapabilities(params: unknown): Promise<{ zkSystems: string[]; busy: boolean; fakeProver?: boolean }>;
	zkpSelectCircuit(criteria: unknown): Promise<unknown>;
}

const BRIDGE_WAIT_MS = 3000;

function bridge(): NativeZkRegistryBridge | null {
	const w = (globalThis as { nativeWrapper?: Partial<NativeZkRegistryBridge> }).nativeWrapper;
	return w && typeof w.zkpSelectCircuit === 'function' && typeof w.zkpCapabilities === 'function'
		? (w as NativeZkRegistryBridge)
		: null;
}

/**
 * Delegates circuit selection to the wrapper app siros-sdk-kotlin, which owns the catalogue and matching.
 * This mirrors the behavior of the WSCD Manager Native Wrapper Host..
 */
export class CircuitZkNativeWrapperRegistryHost implements ICircuitZkRegistryHost {
	readonly id = CircuitZkRegistryHosts.NATIVE_WRAPPER;
	readonly priority = CircuitZkHostPriority.NATIVE_WRAPPER;

	async initialize(): Promise<void> {
		// The wrapper injects its bridge after the page starts.
		const deadline = Date.now() + BRIDGE_WAIT_MS;
		while (!bridge() && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	async isAvailable(): Promise<boolean> {
		const b = bridge();
		if (!b) {
			const nw = (globalThis as { nativeWrapper?: Record<string, unknown> }).nativeWrapper;
			console.warn(
				'[circuit-zk] native bridge incomplete: need zkpCapabilities and zkpSelectCircuit, have',
				nw ? { zkpCapabilities: typeof nw.zkpCapabilities, zkpSelectCircuit: typeof nw.zkpSelectCircuit } : 'no nativeWrapper',
			);
			return false;
		}
		try {
			const caps = await b.zkpCapabilities({});
			const ok = Array.isArray(caps?.zkSystems) && caps.zkSystems.length > 0;
			if (!ok) console.warn('[circuit-zk] native wrapper reports no ZK systems:', caps);
			return ok;
		} catch (e) {
			console.warn('[circuit-zk] zkpCapabilities failed:', e);
			return false;
		}
	}

	async selectCircuit(criteria: CircuitZkSelectionCriteria): Promise<CircuitZkSelection | null> {
		const b = bridge();
		if (!b) {
			throw new CircuitZkError('access_denied', 'Native wrapper bridge is not available');
		}

		const result = await b.zkpSelectCircuit(criteria);
		if (result === null) return null;
		if (!this.#isSelection(result)) {
			throw new CircuitZkError('access_denied', 'Invalid circuit selection returned from native wrapper');
		}
		return result;
	}

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