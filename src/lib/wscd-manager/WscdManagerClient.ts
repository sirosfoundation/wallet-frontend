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
	GenerateDeviceResponseWithProximityRequest,
	GenerateOpenid4vciProofsRequest,
	IWscdManagerClient,
	IWscdManagerHost,
	Keypair,
	SignSdJwtPresentationRequest,
	SignVcdm2PresentationRequest,
	WscdEligibilityRequirements,
} from './types';
import {
	buildOid4vpDcApiSessionTranscript,
	buildOid4vpSessionTranscript,
	generateMdocDeviceResponse,
	prepareSdJwtPresentation,
} from '../verifiable-credentials';
import { base64url, type JWK } from 'jose';
import { logger } from '@/logger';
import { Mutex } from '../utils';
import { prepareVcdm2Presentation } from '../verifiable-credentials/formats/vcdm2';

class ProofKeyMismatchError extends Error {
	constructor() {
		super('the key proof names a different key than the one asked to sign it');
	}
}

/**
 * Checks that a JWS signing input is an OpenID4VCI key proof (§7.2.1.1, JWT
 * proof type) and returns the public key its header names. Throws otherwise.
 */
function checkOpenid4vciProofJwt(signingInput: string): JWK {
	const parts = signingInput.split('.');
	if (parts.length !== 2) throw new Error('not a JWS signing input');
	let header: Record<string, unknown>;
	let payload: Record<string, unknown>;
	try {
		header = JSON.parse(new TextDecoder().decode(base64url.decode(parts[0])));
		payload = JSON.parse(new TextDecoder().decode(base64url.decode(parts[1])));
	} catch {
		throw new Error('not a JWS signing input');
	}
	if (header?.typ !== 'openid4vci-proof+jwt') throw new Error('only an OpenID4VCI key proof can be signed');
	if (header.alg !== 'ES256') throw new Error(`unsupported proof algorithm ${String(header.alg)}`);
	const jwk = header.jwk as JWK | undefined;
	if (!jwk || typeof jwk !== 'object' || 'd' in jwk) throw new Error('the key proof does not carry a public jwk');
	if (typeof payload?.aud !== 'string' || !payload.aud) throw new Error('the key proof has no audience');
	if (typeof payload.iat !== 'number') throw new Error('the key proof has no issue time');
	if (payload.nonce !== undefined && typeof payload.nonce !== 'string') throw new Error('the key proof nonce is not a string');
	return jwk;
}

function sameEcPublicKey(a: JWK, b: JWK): boolean {
	return a.kty === 'EC' && a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

export class WscdManagerClient implements IWscdManagerClient {
	#ready: Promise<void>;
	#availableHosts: IWscdManagerHost[] = [];
	#lock: Mutex = new Mutex();
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
		verifiableCredential,
		transactionDataResponseParams,
	}: SignSdJwtPresentationRequest): Promise<string> {
		const { kid, sdJwt, signingInput } = await prepareSdJwtPresentation(
			verifiableCredential,
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

	public async signVcdm2Presentation({
		audience,
		nonce,
		verifiableCredentials,
		transactionDataResponseParams,
	}: SignVcdm2PresentationRequest): Promise<string> {
		if (verifiableCredentials.length === 0) {
			throw new Error("A presentation must contain at least one credential");
		}

		const { kid, signingInput } = await prepareVcdm2Presentation(
			verifiableCredentials,
			nonce,
			audience,
			transactionDataResponseParams,
		);

		const sig = await this.#dispatchSignRequest(
			kid,
			new TextEncoder().encode(signingInput),
		);

		return `${signingInput}.${base64url.encode(sig)}`;
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

	public async generateDeviceResponseWithProximity({
		credential,
		disclosedClaims,
		sessionTranscriptBytes,
	}: GenerateDeviceResponseWithProximityRequest): Promise<Uint8Array> {
		return generateMdocDeviceResponse(
			credential,
			disclosedClaims,
			sessionTranscriptBytes,
			(kid, data) => this.#dispatchSignRequest(kid, data),
		);
	}

	/**
	 * Signs a key proof the in-browser engine assembled, typically with a key
	 * generateKeypairs just made. See IWscdSignOperations.signOpenid4vciProofJwt.
	 *
	 * Unlike the other operations, this does not re-seed the host first. The
	 * key generation persisted the new container through the exporter, but the
	 * importer reads the keystore's React state, which only reflects it after a
	 * re-render: re-seeding right away would import the container from before
	 * the key existed and drop it ("key not found"). So the host signs with its
	 * current state, and is re-seeded only if it does not know the key (a fresh
	 * page, or a key generated in an earlier session).
	 */
	public async signOpenid4vciProofJwt(kid: string, signingInput: string): Promise<Uint8Array> {
		const headerJwk = checkOpenid4vciProofJwt(signingInput);
		const data = new TextEncoder().encode(signingInput);
		await this.#ready;

		return this.#lock.runExclusive(async () => {
			const host = await this.#selectHost(requirementsForCredential(kid));
			const signWithKnownKey = async () => {
				// The proof must name the key that signs it: otherwise a valid
				// signature would vouch for a key the wallet does not hold.
				if (!sameEcPublicKey(headerJwk, await host.exportPublicKey(kid))) {
					throw new ProofKeyMismatchError();
				}
				return host.sign(kid, data);
			};
			try {
				return await signWithKnownKey();
			} catch (err) {
				if (err instanceof ProofKeyMismatchError) throw err;
				logger.debug(`Proof signing with '${host.id}' needs the stored container: ${err}`);
			}
			await this.#seedHostContainer(host);
			return signWithKnownKey();
		});
	}

	public async generateKeypairs(count: number): Promise<Keypair[]> {
		await this.#ready;

		return this.#lock.runExclusive(async () => {
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
		});
	}

	public async generateOpenid4vciProofs(
		requests: GenerateOpenid4vciProofsRequest[],
	): Promise<string[]> {
		await this.#ready;

		return this.#lock.runExclusive(async () => {
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
		});
	}

	public async dispose(): Promise<void> {
		await Promise.all(this.#availableHosts.map((h) => h.dispose?.()));
	}

	async #dispatchSignRequest(
		kid: string,
		data: Uint8Array,
	): Promise<Uint8Array> {
		await this.#ready;

		return this.#lock.runExclusive(async () => {
			const requirements = requirementsForCredential(kid);
			const host = await this.#selectHost(requirements);
			await this.#seedHostContainer(host);

			const result = await host.sign(kid, data);

			logger.debug(`Completed sign request with host '${host.id}'`);
			return result;
		})
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

		const [strongest] = eligible.toSorted((a, b) => b.strength - a.strength);
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
