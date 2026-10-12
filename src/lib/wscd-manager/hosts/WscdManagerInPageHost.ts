import init, { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import wasmUrl from '@sirosfoundation/wscd-manager-wasm/siros_wscd_manager_bg.wasm?url';
import type { JWK } from 'jose';
import { WEBAUTHN_RPID } from '@/config';
import { logger } from '@/logger';
import { type WscdContainer, WscdHostStrength, WscdManagerHosts, WscdPlugin } from '../resources';
import type { AuthFactor, IWscdManagerHost, WscdEligibilityRequirements } from '../types';
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
		// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
		logger.debug('WscdManagerInPageHost initialized');
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async isAvailable() {
		// In-page host is always available.
		return true;
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async isEligible({ plugin, factors }: WscdEligibilityRequirements) {
		const supportsPlugin = this.supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supportsPlugin && satisfiesFactors;
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async importContainer(container: WscdContainer): Promise<void> {
		const result = ensureEncodedWscdContainer(container);
		this.#wscd.importContainer(result);
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async exportContainer(): Promise<WscdContainer> {
		return ensureDecodedWscdContainer(this.#wscd.exportContainer());
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async sign(kid: string, data: Uint8Array): Promise<Uint8Array> {
		return this.#wscd.sign(kid, data);
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async generateKey(): Promise<string> {
		return this.#wscd.generateKey();
	}

	async exportPublicKey(kid: string): Promise<JWK> {
		return await this.#wscd.exportPublicKey(kid);
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
