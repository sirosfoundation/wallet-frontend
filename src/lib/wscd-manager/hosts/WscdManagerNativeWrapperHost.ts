import { WEBAUTHN_RPID } from '@/config';
import { WscdManagerHosts, WscdHostStrength, WscdPlugin, WscdContainer } from '../resources';
import {
	AuthFactor,
	IWscdManagerHost,
	WscdEligibilityRequirements,
} from '../types';
import { ensureDecodedWscdContainer, ensureEncodedWscdContainer } from '../utils';

export class WscdManagerNativeWrapperHost implements IWscdManagerHost {
	readonly supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);

	readonly id = WscdManagerHosts.NATIVE_WRAPPER;
	readonly strength = WscdHostStrength.NATIVE_WRAPPER;

	public async initialize() {
		// no-op
	}

	public async isAvailable() {
		return (
			typeof window.nativeWrapper?.callWscd === 'function'
		)
	}

	public async isEligible({
		plugin,
		factors,
	}: WscdEligibilityRequirements) {
		const supported = this.supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supported && satisfiesFactors;
	}

	public async importContainer(container: WscdContainer): Promise<void> {
		await window.nativeWrapper.callWscd(
			'importContainer',
			ensureEncodedWscdContainer(container)
		);
	}

	public async exportContainer(): Promise<WscdContainer> {
		const result = await window.nativeWrapper.callWscd(
			'exportContainer',
		);

		if (!(result instanceof Uint8Array)) {
			throw new Error('Invalid container exported from native wrapper');
		}

		return ensureDecodedWscdContainer(result);
	}

	public async sign(keyHandle: string, data: Uint8Array): Promise<Uint8Array> {
		const result = await window.nativeWrapper.callWscd('sign', keyHandle, data);

		if (!(result instanceof Uint8Array)) {
			throw new Error('Invalid signature returned from native wrapper');
		}

		return result;
	}

	#canSatisfyFactor(factor: AuthFactor): boolean {
		switch (factor.kind) {
			case 'none':
			case 'opaque-pin':
				return true;
			case 'webauthn':
				return factor.rpId === WEBAUTHN_RPID;
		}
	}
}
