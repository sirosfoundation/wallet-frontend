import { WscdManagerInPageHost } from './hosts/WscdManagerInPageHost';
import { IWscdManagerClient, IWscdManagerHost, IWscdOperations, OperationReturnType, WscdEligibilityRequirements } from './types';
import { requirementsForOperation } from './utils';

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	constructor() { this.#ready = this.#initialize(); }   // kick off; don't await in ctor

	#availableHosts: IWscdManagerHost[] = [];

	async #initialize(): Promise<void> {
		await this.#registerHosts([
			new WscdManagerInPageHost(),
		]);
	}

	async generateKeyPairs(): Promise<void> {
		return await this.#dispatchOperation(
			'generateKeyPairs',
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
