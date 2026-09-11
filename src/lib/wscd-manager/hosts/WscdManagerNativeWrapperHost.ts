import { WEBAUTHN_RPID } from '@/config';
import { WscdManagerHosts, WscdHostStrength, WscdPlugin } from '../resources';
import {
	AuthFactor,
	IWscdManagerHost,
	IWscdOperations,
	OperationReturnType,
	WscdEligibilityRequirements,
} from '../types';

export class WscdManagerNativeWrapperHost implements IWscdManagerHost {
	#supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);

	readonly id = WscdManagerHosts.NATIVE_WRAPPER;
	readonly strength = WscdHostStrength.NATIVE_WRAPPER;

	public async initialize() {
		// Implement the initialization logic for the native wrapper host here.
		// For now, just resolve immediately.
		return Promise.resolve();
	}

	public async isAvailable() {
		// Implement the availability check logic for the native wrapper host here.
		// @ts-ignore
		return window.nativeWrapper?.wscdManager !== undefined;
	}

	public async isEligible({
		plugin,
		factors,
	}: WscdEligibilityRequirements) {
		const supported = this.#supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supported && satisfiesFactors;
	}

	public async runOperation<T extends keyof IWscdOperations>(
		id: T,
		...args: Parameters<IWscdOperations[T]>
	): Promise<OperationReturnType<T>> {
		// Implement the operation execution logic for the native wrapper host here.
		// For now, just throw an error indicating it's not implemented.
		throw new Error('runOperation not implemented');
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
