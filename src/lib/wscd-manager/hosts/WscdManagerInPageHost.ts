import init, { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import wasmUrl from '@sirosfoundation/wscd-manager-wasm/siros_wscd_manager_bg.wasm?url';
import { WEBAUTHN_RPID } from '@/config';
import {
	WscdManagerHosts,
	WscdPlugin,
	WscdHostStrength,
	WscdContainer,
} from '../resources';
import type {
	AuthFactor,
	IWscdManagerHost,
	WscdEligibilityRequirements,
} from '../types';
import { logger } from '@/logger';
import { ensureDecodedWscdContainer, ensureEncodedWscdContainer } from '../utils';

export class WscdManagerInPageHost implements IWscdManagerHost {
	readonly supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
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
		const supportsPlugin = this.supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supportsPlugin && satisfiesFactors;
	}

	async importContainer(container: WscdContainer): Promise<void> {
		const result = ensureEncodedWscdContainer(container);
		this.#wscd.importContainer(result);
	}

	async exportContainer(): Promise<WscdContainer> {
		return ensureDecodedWscdContainer(this.#wscd.exportContainer());
	}

	async sign(kid: string, data: Uint8Array): Promise<Uint8Array> {
		return this.#wscd.sign(kid, data);
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
