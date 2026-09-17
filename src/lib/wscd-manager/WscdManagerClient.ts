import { WscdManagerInPageHost } from './hosts/WscdManagerInPageHost';
import { WscdManagerWorkerHost } from './hosts/WscdManagerWorkerHost';
import {
	exportWscdContainerToKeystore,
	hostNeedsContainerImportExport,
	requirementsForCredential,
} from './utils';
import { WscdContainer, WscdPlugin } from './resources';
import {
	AuthFactor,
	GenerateDeviceResponseForDCAPIRequest,
	GenerateDeviceResponseRequest,
	GenerateOpenid4vciProofsRequest,
	IWscdManagerClient,
	IWscdManagerHost,
	Keypair,
	SignSdJwtPresentationRequest,
	WscdEligibilityRequirements,
} from './types';
import {
	buildOid4vpDcApiSessionTranscript,
	buildOid4vpSessionTranscript,
	generateMdocDeviceResponse,
	prepareSdJwtPresentation,
} from '../verifiable-credentials';
import { base64url } from 'jose';
import { logger } from '@/logger';

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	#availableHosts: IWscdManagerHost[] = [];
	#containerImportCallback: () => Promise<WscdContainer>;
	#containerExportCallback: (container: WscdContainer) => Promise<void>;

	constructor(
		hosts: IWscdManagerHost[] = [
			new WscdManagerInPageHost(),
			new WscdManagerWorkerHost(),
		],
	) {
		this.#ready = this.#initialize(hosts);
	}

	async #initialize(hosts: IWscdManagerHost[]): Promise<void> {
		await this.#registerHosts(hosts);
	}

	public setContainerImporter(callback: () => Promise<WscdContainer>): void {
		this.#containerImportCallback = callback;
	}

	public setContainerExporter(
		callback: (container: WscdContainer) => Promise<void>,
	): void {
		this.#containerExportCallback = callback;
	}

	public async signSdJwtPresentation({
		audience,
		nonce,
		verifiableCredentials,
		transactionDataResponseParams,
	}: SignSdJwtPresentationRequest): Promise<string> {
		const { kid, sdJwt, signingInput } = await prepareSdJwtPresentation(
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
		return sdJwt + kbJwt;
	}

	public async generateDeviceResponse({
		credential,
		disclosedClaims,
		sessionTranscript,
	}: GenerateDeviceResponseRequest): Promise<Uint8Array> {
		const transcript = await buildOid4vpSessionTranscript(sessionTranscript);

		return generateMdocDeviceResponse(
			credential,
			disclosedClaims,
			transcript,
			(kid, data) => this.#dispatchSignRequest(kid, data),
		);
	}

	public async generateDeviceResponseForDCAPI({
		credential,
		disclosedClaims,
		sessionTranscript,
	}: GenerateDeviceResponseForDCAPIRequest): Promise<Uint8Array> {
		const transcript =
			await buildOid4vpDcApiSessionTranscript(sessionTranscript);

		return generateMdocDeviceResponse(
			credential,
			disclosedClaims,
			transcript,
			(kid, data) => this.#dispatchSignRequest(kid, data),
		);
	}

	public async generateDeviceResponseWithProximity(): Promise<Uint8Array> {
		return Promise.resolve(new Uint8Array());
	}

	public async generateKeypairs(count: number): Promise<Keypair[]> {
		await this.#ready;

		const requirements = await this.#determineElegibilityRequirements();
		const host = await this.#selectHost(requirements);
		await this.#seedHostContainer(host);

		const keys: Keypair[] = [];
		for (let i = 0; i < count; i++) {
			const kid = await host.generateKey(),
				publicKey = await host.exportPublicKey(kid);

			keys.push({ kid, publicKey });
		}

		await this.#persistHostContainer(host);

		logger.debug(`Generated ${keys.length} key(s) with host '${host.id}'`);
		return keys;
	}

	public async generateOpenid4vciProofs(
		requests: GenerateOpenid4vciProofsRequest[],
	): Promise<string[]> {
		await this.#ready;

		const requirements = await this.#determineElegibilityRequirements();
		const host = await this.#selectHost(requirements);
		await this.#seedHostContainer(host);

		const proofs: string[] = [];
		for (const { nonce, audience, issuer } of requests) {
			const kid = await host.generateKey();
			const publicKey = await host.exportPublicKey(kid);

			const proof = await this.#signCompactJws(
				host,
				kid,
				{
					alg: 'ES256',
					typ: 'openid4vci-proof+jwt',
					jwk: { ...publicKey, kid, key_ops: ['verify'] },
				},
				{
					nonce,
					aud: audience,
					iss: issuer,
					iat: Math.floor(Date.now() / 1000),
				},
			);

			proofs.push(proof);
		}

		await this.#persistHostContainer(host);

		logger.debug(`Generated ${proofs.length} OpenID4VCI proof(s) with host '${host.id}'`);
		return proofs;
	}

	async #dispatchSignRequest(
		kid: string,
		data: Uint8Array,
	): Promise<Uint8Array> {
		await this.#ready;
		const requirements = requirementsForCredential(kid);
		const host = await this.#selectHost(requirements);
		await this.#seedHostContainer(host);

		const result = await host.sign(kid, data);

		logger.debug(`Completed sign request with host '${host.id}'`);
		return result;
	}

	async #determineElegibilityRequirements(): Promise<WscdEligibilityRequirements> {
		return {
			plugin: WscdPlugin.SOFTKEY,
			factors: [{ kind: 'none' } as AuthFactor],
		};
	}

	async #registerHosts(hosts: IWscdManagerHost[]): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize()));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable()),
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}

	/**
	 * Selects the most eligible host based on the given requirements.
	 */
	async #selectHost(
		req: WscdEligibilityRequirements,
	): Promise<IWscdManagerHost> {
		const eligible = (
			await Promise.all(
				this.#availableHosts.map(async (host) =>
					(await host.isEligible(req)) ? host : null,
				),
			)
		).filter((h): h is IWscdManagerHost => h !== null);

		const [strongest] = eligible.sort((a, b) => b.strength - a.strength);
		if (!strongest)
			throw new Error('No eligible WSCD host for these requirements');

		return strongest;
	}

	/**
	 * Seeds the host container if it requires import.
	 *
	 * This is currently only relevant for operations running on softkeys,
	 * since we're importing from the keystore into the wscd host container.
	 */
	async #seedHostContainer(host: IWscdManagerHost): Promise<void> {
		const needsImport = hostNeedsContainerImportExport(host);

		if (!needsImport) return;

		if (!this.#containerImportCallback) {
			throw new Error('Container import callback not set');
		}

		const bytes = await this.#containerImportCallback();
		if (!bytes) {
			throw new Error('Container import callback did not return any bytes');
		}

		await host.importContainer(bytes);
	}

	/**
	 * Exports the host container for the keystore to consume if needed.
	 *
	 * For now, only needed for softkeys that should be persisted
	 * in the keystore.
	 */
	async #persistHostContainer(host: IWscdManagerHost): Promise<void> {
		const needsExport = hostNeedsContainerImportExport(host);
		if (!needsExport) return;

		if (!this.#containerExportCallback) {
			throw new Error('Container export callback not set');
		}

		const container = await host.exportContainer();
		if (!container) {
			throw new Error('Container export did not return any bytes');
		}

		const exportedContainer = await exportWscdContainerToKeystore(
			host,
			container,
		);

		await this.#containerExportCallback(exportedContainer);
	}

	/**
	 * Assembles and signs a compact JWS (RFC 7515) with the given host key.
	 */
	async #signCompactJws(
		host: IWscdManagerHost,
		kid: string,
		header: Record<string, unknown>,
		payload: Record<string, unknown>,
	): Promise<string> {
		const signingInput = `${base64url.encode(JSON.stringify(header))}.${base64url.encode(JSON.stringify(payload))}`;
		const sig = await host.sign(
			kid,
			new TextEncoder().encode(signingInput),
		);
		return `${signingInput}.${base64url.encode(sig)}`;
	}
}
