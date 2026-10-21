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
	zkpCapabilities(
		params: unknown,
	): Promise<{ zkSystems: string[]; busy: boolean; fakeProver?: boolean }>;
	zkpSelectCircuit(criteria: unknown): Promise<unknown>;
}

const BRIDGE_WAIT_MS = 3000;

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
		while (!this.#bridge() && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	async isAvailable(): Promise<boolean> {
		const bridge = this.#bridge();
		if (!bridge) {
			const nativeWrapper = (
				globalThis as { nativeWrapper?: Record<string, unknown> }
			).nativeWrapper;

			console.warn(
				'[zkp-req] native bridge incomplete: need zkpCapabilities and zkpSelectCircuit, have',
				nativeWrapper
					? {
							zkpCapabilities: typeof nativeWrapper.zkpCapabilities,
							zkpSelectCircuit: typeof nativeWrapper.zkpSelectCircuit,
						}
					: 'no nativeWrapper',
			);
			return false;
		}
		try {
			const capabilities = await bridge.zkpCapabilities({});

			const hasSystems =
				Array.isArray(capabilities?.zkSystems) &&
				capabilities.zkSystems.length > 0;

			if (!hasSystems) {
				console.warn(
					'[zkp-req] native wrapper reports no ZK systems:',
					capabilities,
				);
			}

			return hasSystems;
		} catch (error) {
			console.warn('[zkp-req] zkpCapabilities failed:', error);
			return false;
		}
	}

	async selectSystem(
		criteria: ZkpReqSelectionCriteria,
	): Promise<ZkpReqSelection | null> {
		const bridge = this.#bridge();
		if (!bridge) {
			throw new ZkpReqError(
				'access_denied',
				'Native wrapper bridge is not available',
			);
		}

		// The native bridge keeps its own field names.
		const result = await bridge.zkpSelectCircuit({
			doctype: criteria.typeValue,
			req: criteria.req,
			acceptedCircuitIds: criteria.acceptedSystemIds,
			acceptedSystems: criteria.acceptedSystems,
		});

		if (result === null) return null;

		if (!this.#isNativeSelection(result)) {
			throw new ZkpReqError(
				'access_denied',
				'Invalid system selection returned from native wrapper',
			);
		}


		const { circuitId, ...rest } = result;
		return { ...rest, systemId: circuitId };
	}

	#bridge(): NativeZkRegistryBridge | null {
		const nativeWrapper = (
			globalThis as { nativeWrapper?: Partial<NativeZkRegistryBridge> }
		).nativeWrapper;
		return nativeWrapper &&
			typeof nativeWrapper.zkpSelectCircuit === 'function' &&
			typeof nativeWrapper.zkpCapabilities === 'function'
			? (nativeWrapper as NativeZkRegistryBridge)
			: null;
	}

	#isNativeSelection(
		value: unknown,
	): value is Omit<ZkpReqSelection, 'systemId'> & { circuitId: string } {
		if (typeof value !== 'object' || value === null) return false;
		const selection = value as Record<string, unknown>;
		return (
			typeof selection.circuitId === 'string' &&
			typeof selection.proofSystem === 'string' &&
			typeof selection.proofSystemVersion === 'string'
		);
	}
}
