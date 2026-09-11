import { PlatformCapability, WscdPlugin } from './resources';
import type {
	IWscdOperations,
	WscdEligibilityRequirements,
	AuthFactor,
	WscdKeyMetadata,
} from './types';

export function requirementsForOperation(
	op: keyof IWscdOperations,
	kid: string,
): WscdEligibilityRequirements {
	const meta = wscdKeyMetadata(kid);

	return {
		plugin: meta.plugin,
		factors: meta.factors,
		capabilities: capabilitiesForOperation(op, meta.plugin),
	};
}

export function capabilitiesForOperation(
	op: keyof IWscdOperations,
	plugin: WscdPlugin
): PlatformCapability[] {
	const caps: PlatformCapability[] = [];

	switch (op) {
		case 'generateDeviceResponseForDCAPI':
			caps.push(PlatformCapability.DIGITAL_CREDENTIALS);
			break;
		case 'generateDeviceResponseWithProximity':
			caps.push(PlatformCapability.PROXIMITY);
			break;
	}

	switch (plugin) {
		case WscdPlugin.R2PS:
			caps.push(PlatformCapability.NETWORK); // remote signing
			break;
	}

	return caps;
}

/**
 * @todo Implement logic to retrieve the actual metadata for the given key ID.
 * 			 Dependant on the S.extensions work in the wallet privateData.
 */
function wscdKeyMetadata(kid: string): WscdKeyMetadata {
	void kid; // currently unused, placeholder for future implementation

	return {
		plugin: WscdPlugin.SOFTKEY,
		factors: [{ kind: 'none' }] as AuthFactor[],
	};
}
