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
import { base64url, calculateJwkThumbprint } from 'jose';

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	#availableHosts: IWscdManagerHost[] = [];
	#containerImportCallback: () => Promise<WscdContainer>;
	#containerExportCallback: (container: WscdContainer) => Promise<void>;

	constructor() {
		this.#ready = this.#initialize();
	}

	async #initialize(): Promise<void> {
		await this.#registerHosts([
			new WscdManagerInPageHost(),
			new WscdManagerWorkerHost(),
		]);
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
			const keyHandle = await host.generateKey(),
				publicKey = await host.exportPublicKey(keyHandle),
				kid = await calculateJwkThumbprint(publicKey, 'sha256');

			keys.push({ kid, publicKey });
		}

		await this.#persistHostContainer(host);

		return keys;
	}

	public async generateOpenid4vciProofs(
		requests: GenerateOpenid4vciProofsRequest[],
	): Promise<string[]> {
		await this.#ready;

		const requirements = {
			plugin: WscdPlugin.SOFTKEY,
			factors: [{ kind: 'none' } as AuthFactor],
		};
		const host = await this.#selectHost(requirements);
		await this.#seedHostContainer(host);

		const proofs: string[] = [];
		for (const { nonce, audience, issuer } of requests) {
			const keyHandle = await host.generateKey();
			const publicKey = await host.exportPublicKey(keyHandle);
			const kid = await calculateJwkThumbprint(publicKey, 'sha256');

			const proof = await this.#signCompactJws(
				host,
				keyHandle,
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

		const keyHandle = await this.#resolveKeyHandle(kid);
		const result = await host.sign(keyHandle, data);

		return result;
	}

	async #determineElegibilityRequirements(): Promise<WscdEligibilityRequirements> {
		return {
			plugin: WscdPlugin.SOFTKEY,
			factors: [{ kind: 'none' } as AuthFactor],
		};
	}

	/**
	 * Translates a canonical kid (JWK thumbprint) to the host key handle.
	 * Softkey re-keys under the thumbprint (handle === kid); other plugins will
	 * need a real lookup, e.g. an in-memory kid -> keyHandle map.
	 */
	async #resolveKeyHandle(kid: string): Promise<string> {
		return kid;
	}

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
	 * Assembles and signs a compact JWS (RFC 7515) with the given host key.
	 */
	async #signCompactJws(
		host: IWscdManagerHost,
		keyHandle: string,
		header: Record<string, unknown>,
		payload: Record<string, unknown>,
	): Promise<string> {
		const signingInput = `${base64url.encode(JSON.stringify(header))}.${base64url.encode(JSON.stringify(payload))}`;
		const sig = await host.sign(
			keyHandle,
			new TextEncoder().encode(signingInput),
		);
		return `${signingInput}.${base64url.encode(sig)}`;
	}
}
