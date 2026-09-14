import { WscdPlugin } from './resources';
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
export function hostNeedsContainerImport(host: IWscdManagerHost): boolean {
	return host.supportedPlugins.has(WscdPlugin.SOFTKEY);
}
