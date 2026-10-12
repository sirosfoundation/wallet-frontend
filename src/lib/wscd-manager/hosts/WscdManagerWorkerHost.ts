import type { JWK } from 'jose';
import { WEBAUTHN_RPID } from '@/config';
import { logger } from '@/logger';
import {
	type WscdContainer,
	WscdHostStrength,
	WscdManagerError,
	WscdManagerHosts,
	WscdPlugin,
} from '../resources';
import type {
	AuthFactor,
	IWscdManagerHost,
	WorkerMessage,
	WorkerResponse,
	WorkerResult,
	WscdEligibilityRequirements,
} from '../types';
import { ensureDecodedWscdContainer, ensureEncodedWscdContainer } from '../utils';
import WscdManagerWorker from '../worker?worker';

const WSCD_WORKER_TIMEOUT_MS = 5000;

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

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async initialize(): Promise<void> {
		this.#worker = new WscdManagerWorker();

		this.#worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
			const pending = this.#pending.get(data.id);
			if (!pending) return;
			this.#pending.delete(data.id);
			// biome-ignore lint/suspicious/noUnusedExpressions: baseline: pre-existing debt. should be fixed
			'error' in data
				? pending.reject(new WscdManagerError(data.error))
				: pending.resolve(data.result);
		};

		this.#worker.onerror = (event) => this.#failAllPending(event.message ?? 'Worker error');

		this.#worker.onmessageerror = () =>
			this.#failAllPending('Worker message deserialization failed');

		logger.debug('WscdManagerWorkerHost initialized');
	}

	public async isAvailable(): Promise<boolean> {
		if (!window.Worker) return false;
		const pong = await this.#messageWorker({ action: 'ping' });
		return pong === true;
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async isEligible({ plugin, factors }: WscdEligibilityRequirements) {
		const supported = this.supportedPlugins.has(plugin);
		const satisfiesFactors = factors.every((f) => this.#canSatisfyFactor(f));

		return supported && satisfiesFactors;
	}

	public async importContainer(container: WscdContainer): Promise<void> {
		await this.#messageWorker({
			action: 'import_container',
			container: ensureEncodedWscdContainer(container),
		});
		logger.debug('Container imported successfully to web worker host');
	}

	public async exportContainer(): Promise<WscdContainer> {
		const result = await this.#messageWorker({
			action: 'export_container',
		});

		return ensureDecodedWscdContainer(result);
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async sign(kid: string, data: Uint8Array): Promise<Uint8Array> {
		return this.#messageWorker({
			action: 'sign_request',
			kid: kid,
			data,
		});
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async generateKey(): Promise<string> {
		return this.#messageWorker({
			action: 'generate_key',
		});
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async exportPublicKey(kid: string): Promise<JWK> {
		return this.#messageWorker({
			action: 'export_public_key',
			kid: kid,
		});
	}

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	public async dispose(): Promise<void> {
		this.#worker?.terminate();
		this.#failAllPending('Worker terminated');
	}

	#messageWorker<A extends WorkerMessage['action']>(
		message: Extract<WorkerMessage, { action: A }>,
	): Promise<WorkerResult<A>> {
		const id = this.#nextId++;
		return new Promise<WorkerResult<A>>((resolve, reject) => {
			const resolveUnknown = resolve as (v: unknown) => void;

			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) {
					reject(new WscdManagerError(`WSCD worker '${message.action}' timed out`));
				}
			}, WSCD_WORKER_TIMEOUT_MS);

			this.#pending.set(id, {
				resolve: (v: unknown) => {
					clearTimeout(timer);
					resolveUnknown(v);
				},
				reject: (e: unknown) => {
					clearTimeout(timer);
					reject(e);
				},
			});
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

	#failAllPending(message: string): void {
		for (const [, pending] of this.#pending) {
			pending.reject(new WscdManagerError(message));
		}
		this.#pending.clear();
	}
}
