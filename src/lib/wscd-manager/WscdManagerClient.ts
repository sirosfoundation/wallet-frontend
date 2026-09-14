import { WscdManagerInPageHost } from './hosts/WscdManagerInPageHost';
// import { WscdManagerNativeWrapperHost } from './hosts/WscdManagerNativeWrapperHost';
// import { WscdManagerWalletCompanionHost } from './hosts/WscdManagerWalletCompanionHost';
// import { WscdManagerWorkerHost } from './hosts/WscdManagerWorkerHost';
import { hostNeedsContainerImportExport, requirementsForCredential } from './utils';
import { WscdContainer } from './resources';
import {
	IWscdManagerClient,
	IWscdManagerHost,
	SignJwtPresentationRequest,
	WscdEligibilityRequirements,
} from './types';
import { prepareSdJwtPresentation } from '../verifiable-credentials';
import { base64url } from 'jose';

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	#availableHosts: IWscdManagerHost[] = [];
	#containerImportCallback: () => Promise<WscdContainer>;
	// #containerExportCallback: (container: WscdContainer) => Promise<void>;

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

	setContainerImporter(callback: () => Promise<WscdContainer>): void {
		this.#containerImportCallback = callback;
	}

	// setContainerExporter(
	// 	callback: (container: WscdContainer) => Promise<void>
	// ): void {
	// 	this.#containerExportCallback = callback;
	// }

	public async signSdJwtPresentation({
		audience,
		nonce,
		verifiableCredentials,
		transactionDataResponseParams,
	}: SignJwtPresentationRequest): Promise<string> {

		const {
			kid,
			sdJwt,
			signingInput,
		} = await prepareSdJwtPresentation(
			verifiableCredentials,
			nonce,
			audience,
			transactionDataResponseParams,
		);

		const sig = await this.#dispatchSignRequest(
			kid,
			new TextEncoder().encode(signingInput),
		);

		const kbJwt = `${signingInput}.${base64url.encode(sig)}`;
		return (sdJwt + kbJwt);
	}

	async generateDeviceResponse(): Promise<void> {
		return Promise.resolve(null);
	}

	async generateDeviceResponseForDCAPI(): Promise<void> {
		return Promise.resolve(null);
	}

	async generateDeviceResponseWithProximity(): Promise<void> {
		return Promise.resolve(null);
	}

	async #registerHosts(hosts: IWscdManagerHost[]): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize()));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable())
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}

	async #dispatchSignRequest(
		kid: string,
		data: Uint8Array
	): Promise<Uint8Array> {
		await this.#ready
		const
			requirements = requirementsForCredential(kid),
			host = await this.#selectHost(requirements),
			needsImport = hostNeedsContainerImportExport(host);

		if (needsImport) {
			if (!this.#containerImportCallback) {
				throw new Error('Container import callback not set');
			}
			const bytes = await this.#containerImportCallback();
			if (bytes) await host.importContainer(bytes);
		}

		const result = await host.sign(kid, data);

		return result;
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
