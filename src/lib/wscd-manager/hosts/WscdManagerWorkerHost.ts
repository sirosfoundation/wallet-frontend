import { WEBAUTHN_RPID } from '@/config';
import WscdManagerWorker from '../worker?worker';
import { WscdManagerHosts, WscdHostStrength, WscdPlugin } from '../resources';
import {
	AuthFactor,
	IWscdManagerHost,
	IWscdOperations,
	OperationReturnType,
	WscdEligibilityRequirements,
} from '../types';
import { logger } from '@/logger';

export class WscdManagerWorkerHost implements IWscdManagerHost {
	#supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);

	readonly id = WscdManagerHosts.WORKER;
	readonly strength = WscdHostStrength.WORKER;

	#worker: Worker;

	public async initialize() {
		this.#worker = new WscdManagerWorker();
		logger.debug('WscdManagerWorkerHost initialized');

		// TODO: remove this debug messages.
		this.#worker.onmessage = (e) => {
			console.log("Message received from worker:", e.data);
		};
		this.#worker.postMessage('listKeys');
	}

	public async isAvailable() {
		return !!window.Worker;
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
		// Implement the operation execution logic for the worker host here.
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
