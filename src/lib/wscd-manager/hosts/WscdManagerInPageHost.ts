import init, { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import wasmUrl from '@sirosfoundation/wscd-manager-wasm/siros_wscd_manager_bg.wasm?url';
import { WEBAUTHN_RPID } from '@/config';
import {
	WscdManagerHosts,
	WscdPlugin,
	WscdHostStrength,
} from '../resources';
import type {
	AuthFactor,
	IWscdManagerHost,
	IWscdOperations,
	OperationReturnType,
	WscdEligibilityRequirements,
} from '../types';
import { logger } from '@/logger';

export class WscdManagerInPageHost implements IWscdManagerHost {
	#supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);

	#wscd: WscdManagerJs;

	readonly id = WscdManagerHosts.IN_PAGE;
	readonly strength = WscdHostStrength.IN_PAGE;

	public async initialize() {
		await init({ module_or_path: wasmUrl });
		this.#wscd = new WscdManagerJs();
		logger.debug('WscdManagerInPageHost initialized');
	}

	public async isAvailable() {
		// In-page host is always available.
		return Promise.resolve(true);
	}

	async isEligible({
		plugin,
		factors,
	}: WscdEligibilityRequirements) {
		const supportsPlugin = this.#supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supportsPlugin && satisfiesFactors;
	}

	async runOperation<T extends keyof IWscdOperations>(
		id: T,
		...args: Parameters<IWscdOperations[T]>
	): Promise<OperationReturnType<T>> {

		// Implement the operation execution logic here.
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
