import { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import { WscdContainer, WscdContainerSchema, WscdPlugin } from './resources';
import type {
	WscdEligibilityRequirements,
	IWscdManagerHost,
} from './types';

/**
 * Requirements for a given credential based on its key ID.
 */
export function requirementsForCredential(
	kid: string,
): WscdEligibilityRequirements {
	void kid;

	// Currently, all credentials are assumed to require the softkey plugin
	// with no authentication factors.
	return {
		plugin: WscdPlugin.SOFTKEY,
		factors: [{ kind: 'none' }],
	};
}

/**
 * Does the host require a container import.
 *
 * Only softkey hosts require a container import.
 */
export function hostNeedsContainerImportExport(host: IWscdManagerHost): boolean {
	return host.supportedPlugins.has(WscdPlugin.SOFTKEY);
}

/**
 * Ensures that the given WscdContainer is valid and returns it as
 * an encoded Uint8Array.
 */
export function ensureEncodedWscdContainer(container: WscdContainer): Uint8Array {
	const { success, error, data } = WscdContainerSchema.safeParse(container);

	if (!success) {
		throw new Error(`Failed to parse WscdContainer: ${error}`);
	}

	return new TextEncoder().encode(JSON.stringify(data));
}

/**
 * Ensures that the given WscdContainer is valid and returns it as
 * a decoded object.
 */
export function ensureDecodedWscdContainer(container: Uint8Array): WscdContainer {
	const { success, error, data } = WscdContainerSchema.safeParse(
		JSON.parse(new TextDecoder().decode(container))
	);

	if (!success) {
		throw new Error(`Failed to parse WscdContainer: ${error}`);
	}

	return data;
}
