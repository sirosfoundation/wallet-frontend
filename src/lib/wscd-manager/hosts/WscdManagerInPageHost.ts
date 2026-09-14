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

	async importContainer(container: Uint8Array): Promise<void> {
		this.#wscd.importContainer(container);
	}

	async exportContainer(): Promise<Uint8Array> {
		return this.#wscd.exportContainer();
	}

	async runOperation<T extends keyof IWscdOperations>(
		id: T,
		...args: Parameters<IWscdOperations[T]>
	): Promise<OperationReturnType<T>> {
		switch (id) {
			case 'generateKeypairs': {
				const kid = await this.#wscd.generateKey();
				const container = this.#wscd.exportContainer();
				const json = JSON.parse(new TextDecoder().decode(container));

				logger.debug('WSCD generated key', kid, 'container bytes:', container.length);
				logger.debug({ kid, container, json })
				return undefined as OperationReturnType<T>;
			}
			default:
			throw new Error(`runOperation: ${String(id)} not implemented`);
		}
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
