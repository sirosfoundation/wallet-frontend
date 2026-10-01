import {
	ExportedWscdContainer,
	ExportedWscdContainerSchema,
	WscdContainer,
	WscdContainerSchema,
	WscdManagerError,
	WscdPlugin,
} from './resources';
import type { WscdEligibilityRequirements, IWscdManagerHost } from './types';
import { browserSupportsPreviewSign } from '../utils/browserSupportsPreviewSign';

/**
 * Requirements for a given credential based on its key ID.
 */
export function requirementsForCredential(
	kid: string,
): WscdEligibilityRequirements {
	void kid;

	// Currently, all credentials are assumed to require the softkey plugin
	// with no authentication factors.
	return { plugin: WscdPlugin.SOFTKEY, factors: [{ kind: 'none' }] };
}

/**
 * Does the host require a container import.
 *
 * Only softkey hosts require a container import.
 */
export function hostNeedsContainerImportExport(
	host: IWscdManagerHost,
): boolean {
	return host.supportedPlugins.has(WscdPlugin.SOFTKEY);
}

/**
 * Ensures that the given WscdContainer is valid and returns it as
 * an encoded Uint8Array.
 */
export function ensureEncodedWscdContainer(
	container: WscdContainer,
): Uint8Array {
	const { success, error, data } = WscdContainerSchema.safeParse(container);

	if (!success) {
		throw new WscdManagerError(`Failed to parse WscdContainer: ${error}`);
	}

	return new TextEncoder().encode(JSON.stringify(data));
}

/**
 * Ensures that the given WscdContainer is valid and returns it as
 * a decoded object.
 */
export function ensureDecodedWscdContainer(
	container: Uint8Array,
): WscdContainer {
	const { success, error, data } = WscdContainerSchema.safeParse(
		JSON.parse(new TextDecoder().decode(container)),
	);

	if (!success) {
		throw new WscdManagerError(`Failed to parse WscdContainer: ${error}`);
	}

	return data;
}

/**
 * Exports the given WscdContainer to a format suitable for keystore import.
 */
export async function exportWscdContainerToKeystore(
	host: IWscdManagerHost,
	container: WscdContainer,
): Promise<ExportedWscdContainer> {
	const keys: ExportedWscdContainer['keys'] = [];

	await Promise.all(
		container.keys.map(async (key) => {
			// host handle as exported by the WSCD
			const publicKey = await host.exportPublicKey(key.kid);
			keys.push({
				...key,
				publicKey,
			});
		}),
	);

	const { success, error, data } =
		ExportedWscdContainerSchema.safeParse({ ...container, keys });
	if (!success) {
		throw new WscdManagerError(
			`Failed to parse ExportedWscdContainer: ${error}`,
		);
	}

	return data;
}

/**
 * Returns a list of WscdPlugins supported by the current environment.
 */
export async function supportedWscdManagerPlugins(): Promise<WscdPlugin[]> {
	const plugins: WscdPlugin[] = [
		// Softkeys are always supported.
		WscdPlugin.SOFTKEY,
	];

	if (await browserSupportsPreviewSign()) {
		plugins.push(WscdPlugin.FIDO2);
	}

	// TODO: figure out criteria for R2PS.

	return plugins;
}
