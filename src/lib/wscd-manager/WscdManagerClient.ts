import { WscdManagerInPageHost } from './hosts/WscdManagerInPageHost';
// import { WscdManagerNativeWrapperHost } from './hosts/WscdManagerNativeWrapperHost';
// import { WscdManagerWalletCompanionHost } from './hosts/WscdManagerWalletCompanionHost';
// import { WscdManagerWorkerHost } from './hosts/WscdManagerWorkerHost';
import {
	IWscdManagerClient,
	IWscdManagerHost,
	IWscdOperations,
	OperationReturnType,
	WscdEligibilityRequirements,
} from './types';
import { hostNeedsContainerImport, requirementsForOperation } from './utils';

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	#availableHosts: IWscdManagerHost[] = [];
	#containerImportCallback: () => Promise<Uint8Array>;

	constructor() {
		this.#ready = this.#initialize();
	}

	async #initialize(): Promise<void> {
		await this.#registerHosts([
			new WscdManagerInPageHost(),
			// new WscdManagerWorkerHost(),
			// new WscdManagerNativeWrapperHost(),
			// new WscdManagerWalletCompanionHost(),
		]);
	}

	setContainerImporter(callback: () => Promise<Uint8Array>): void {
		this.#containerImportCallback = callback;
	}

	async generateKeypairs(): Promise<void> {
		return await this.#dispatchOperation(
			'generateKeypairs',
		);
	}

	async generateOpenid4vciProofs(): Promise<void> {
		return await this.#dispatchOperation(
			'generateOpenid4vciProofs',
		);
	}

	async signJwtPresentation(): Promise<void> {
		return await this.#dispatchOperation(
			'signJwtPresentation',
		);
	}

	async generateDeviceResponse(): Promise<void> {
		return await this.#dispatchOperation(
			'generateDeviceResponse',
		);
	}

	async generateDeviceResponseForDCAPI(): Promise<void> {
		return await this.#dispatchOperation(
			'generateDeviceResponseForDCAPI',
		);
	}

	async generateDeviceResponseWithProximity(): Promise<void> {
		return await this.#dispatchOperation(
			'generateDeviceResponseWithProximity',
		);
	}

	async #registerHosts(hosts: IWscdManagerHost[]): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize()));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable())
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}

	/**
	 * Dispatches the specified operation to the most eligible host based on the operation's requirements.
	 */
	async #dispatchOperation<T extends keyof IWscdOperations>(
		op: T,
		...args: Parameters<IWscdOperations[T]>
	): Promise<OperationReturnType<T>> {
		await this.#ready;
		// TODO: we need to figure out how to obtain the key ID (kid) for the operation
		// It's
		const kid = '';
		const requirements = requirementsForOperation(op, kid);
		const host = await this.#selectHost(requirements);

		if (hostNeedsContainerImport(host)) {
			if (!this.#containerImportCallback) {
				throw new Error('Container import callback not set');
			}
			const bytes = await this.#containerImportCallback();
			if (bytes) await host.importContainer(bytes);
		}

		return host.runOperation(op, ...args);
	}

	/**
	 * Selects the most eligible host based on the given requirements.
	 */
	async #selectHost(req: WscdEligibilityRequirements): Promise<IWscdManagerHost> {
		const eligible = (
			await Promise.all(
				this.#availableHosts.map(async (host) =>
					await host.isEligible(req) ? host : null,
				),
			)
		).filter((h): h is IWscdManagerHost => h !== null);

		const [strongest] = eligible.sort((a, b) => b.strength - a.strength);
		if (!strongest) throw new Error('No eligible WSCD host for these requirements');

		return strongest;
	}
}
