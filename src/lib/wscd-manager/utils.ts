import { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import { WscdContainer, WscdContainerSchema, WscdPlugin } from './resources';
import type {
	IWscdOperations,
	WscdEligibilityRequirements,
	AuthFactor,
	IWscdManagerHost,
} from './types';

/**
 * @todo Implement logic to retrieve the actual metadata for the given key ID.
 * 			 Dependant on the S.extensions work in the wallet privateData.
 */
export function requirementsForOperation(
	op: keyof IWscdOperations,
	kid: string,
): WscdEligibilityRequirements {
	void op;
	void kid;

	return {
		plugin: WscdPlugin.SOFTKEY,
		factors: [{ kind: 'none' }] as AuthFactor[],
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
 * Imports a WscdContainer into the given WscdManagerJs instance.
 */
export function importWscdContainer(
	wscd: WscdManagerJs,
	container: WscdContainer,
): void {
	const { success, error, data } = WscdContainerSchema.safeParse(container);

	if (!success) {
		throw new Error(`Failed to parse WscdContainer: ${error}`);
	}

	wscd.importContainer(
		new TextEncoder().encode(JSON.stringify(data))
	);

	console.log('WscdManager imported container:', data);
}

/**
 * Exports the current WscdContainer from the given WscdManagerJs instance.
 */
export function exportWscdContainer(
	wscd: WscdManagerJs,
): WscdContainer {
	const raw = wscd.exportContainer();
	const json = JSON.parse(new TextDecoder().decode(raw));

	const { success, error, data } = WscdContainerSchema.safeParse(json);

	if (!success) {
		throw new Error(`Failed to parse WscdContainer: ${error}`);
	}

	return data;
}
