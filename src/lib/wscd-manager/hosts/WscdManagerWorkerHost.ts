import { WEBAUTHN_RPID } from '@/config';
import WscdManagerWorker from '../worker?worker';
import { WscdManagerHosts, WscdHostStrength, WscdPlugin, WscdContainer, WscdManagerError } from '../resources';
import {
	AuthFactor,
	IWscdManagerHost,
	WorkerMessage,
	WorkerResponse,
	WorkerResult,
	WscdEligibilityRequirements,
} from '../types';
import { logger } from '@/logger';
import { ensureDecodedWscdContainer, ensureEncodedWscdContainer } from '../utils';

export class WscdManagerWorkerHost implements IWscdManagerHost {
	readonly supportedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);

	readonly id = WscdManagerHosts.WORKER;
	readonly strength = WscdHostStrength.WORKER;

	#worker: Worker;
	#nextId = 0;
	#pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

	public async initialize() {
		this.#worker = new WscdManagerWorker();
		this.#worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
			const pending = this.#pending.get(data.id);
			if (!pending) return;
			this.#pending.delete(data.id);
			'error' in data
				? pending.reject(new WscdManagerError(data.error))
				: pending.resolve(data.result);
		};
		logger.debug('WscdManagerWorkerHost initialized');

		// TODO: remove this debug messages.
		this.#worker.postMessage('listKeys');
	}

	public async isAvailable() {
		if (!window.Worker) return false;
		const pong = await this.#messageWorker({ action: 'ping' });
		return pong === true;
	}

	public async isEligible({
		plugin,
		factors,
	}: WscdEligibilityRequirements) {
		const supported = this.supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supported && satisfiesFactors;
	}

	async importContainer(container: WscdContainer): Promise<void> {
		await this.#messageWorker({
			action: 'import_container',
			container: ensureEncodedWscdContainer(container),
		});
		logger.debug('Container imported successfully to web worker host');
	}

	async exportContainer(): Promise<WscdContainer> {
		const result = await this.#messageWorker({
			action: 'export_container',
		});

		return ensureDecodedWscdContainer(result);
	}

	async sign(keyHandle: string, data: Uint8Array): Promise<Uint8Array> {
		return this.#messageWorker({
			action: 'sign_request',
			keyHandle,
			data,
		});
	}

	#messageWorker<A extends WorkerMessage['action']>(
		message: Extract<WorkerMessage, { action: A }>,
	): Promise<WorkerResult<A>> {
		const id = this.#nextId++;
		return new Promise<WorkerResult<A>>((resolve, reject) => {
			this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.#worker.postMessage({ id, ...message });
		});
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
