import {
	ZkpReqError,
	ZkpReqHostPriority,
	ZkpReqRegistryHosts,
} from '../../resources';
import type {
	ZkpReqSelection,
	ZkpReqSelectionCriteria,
	IZkpReqRegistryHost,
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
 * Delegates system selection to the wrapper app siros-sdk-kotlin, which owns the catalogue and matching.
 * This mirrors the behavior of the WSCD Manager Native Wrapper Host..
 */
export class ZkpReqNativeWrapperRegistryHost implements IZkpReqRegistryHost {
	readonly id = ZkpReqRegistryHosts.NATIVE_WRAPPER;
	readonly priority = ZkpReqHostPriority.NATIVE_WRAPPER;

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
				'[zkp-req] native bridge incomplete: need zkpCapabilities and zkpSelectCircuit, have',
				nw ? { zkpCapabilities: typeof nw.zkpCapabilities, zkpSelectCircuit: typeof nw.zkpSelectCircuit } : 'no nativeWrapper',
			);
			return false;
		}
		try {
			const caps = await b.zkpCapabilities({});
			const ok = Array.isArray(caps?.zkSystems) && caps.zkSystems.length > 0;
			if (!ok) console.warn('[zkp-req] native wrapper reports no ZK systems:', caps);
			return ok;
		} catch (e) {
			console.warn('[zkp-req] zkpCapabilities failed:', e);
			return false;
		}
	}

	async selectSystem(criteria: ZkpReqSelectionCriteria): Promise<ZkpReqSelection | null> {
		const b = bridge();
		if (!b) {
			throw new ZkpReqError('access_denied', 'Native wrapper bridge is not available');
		}

		// The native bridge keeps its own field names.
		const result = await b.zkpSelectCircuit({
			doctype: criteria.typeValue,
			req: criteria.req,
			acceptedCircuitIds: criteria.acceptedSystemIds,
			acceptedSystems: criteria.acceptedSystems,
		});
		if (result === null) return null;
		if (!this.#isNativeSelection(result)) {
			throw new ZkpReqError('access_denied', 'Invalid system selection returned from native wrapper');
		}
		const { circuitId, ...rest } = result;
		return { ...rest, systemId: circuitId };
	}

	#isNativeSelection(
		value: unknown,
	): value is Omit<ZkpReqSelection, 'systemId'> & { circuitId: string } {
		if (typeof value !== 'object' || value === null) return false;
		const s = value as Record<string, unknown>;
		return (
			typeof s.circuitId === 'string' &&
			typeof s.proofSystem === 'string' &&
			typeof s.proofSystemVersion === 'string'
		);
	}
}