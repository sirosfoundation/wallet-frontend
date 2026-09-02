import { calculateJwkThumbprint, EncryptJWT, importJWK, JWK } from 'jose';
import { DCAPIRequest } from './DCAPIRequest';
import { DCAPIMode } from './resources';
import { DCAPIWalletCompanionMode } from './modes';

export class DCAPISession {
	readonly request: DCAPIRequest;
	readonly requestId: string;
	readonly mode: DCAPIMode;

	constructor(url: URL) {
		this.requestId = url.searchParams.get('request_id');
		if (!this.requestId) throw new Error('Missing request_id');

		this.mode = this.#detectMode();
		this.request = new DCAPIRequest(url);
	}

	async initialize(): Promise<void> {
		if (!this.request.dcqlQuery?.credentials?.length) {
			throw new Error('No credentials in DCQL query');
		}
		if (!this.request.nonce) {
			throw new Error('Missing required nonce parameter for DC API request');
		}

		if (this.request.isSigned) {
			await this.request.verifySignature();
		}

		if (this.request.isSigned && !this.request.expectedOrigins?.length) {
			throw new Error('Signed request missing required expected_origins');
		}

		await this.mode.originHandshake(this.requestId, this.request.expectedOrigins);
	}

	get verifiedOrigin(): string {
		return this.mode.verifiedOrigin;
	}

	public async verifierJwkThumbprint(): Promise<string | null> {
		if (this.request.responseMode !== 'dc_api.jwt') return null;
		if (!this.request.clientMetadata) return null;

		const encKey = this.request.clientMetadata?.jwks?.keys?.find(
			(k: Record<string, unknown>) => k.use === 'enc',
		);
		if (!encKey) return null;

		return await calculateJwkThumbprint(encKey as JWK, 'sha256');
	}

	public async sendResponse(vpToken: Record<string, string[]>): Promise<void> {
		const payload =
			this.request.responseMode === 'dc_api.jwt'
				? { response: await this.#encryptResponse(vpToken) }
				: { vp_token: vpToken };

		this.mode.send({ requestId: this.requestId, payload });
		this.close();
	}

	public sendErrorAndClose(error: 'user_cancelled' | 'access_denied'): void {
		this.mode.send({ requestId: this.requestId, payload: { error } });
		this.close();
	}

	public close(): void {
		this.mode.close();
	}

	#detectMode(): DCAPIMode {
		if (window.opener) {
			return new DCAPIWalletCompanionMode();
		}

		throw new Error('Unable to detect DC API mode, no supported environment detected');
	}

	async #encryptResponse(vpToken: Record<string, string[]>): Promise<string> {
		if (!this.request.clientMetadata?.jwks?.keys?.length) {
			throw new Error('dc_api.jwt response_mode requires client_metadata.jwks');
		}

		// Find encryption key (use='enc')
		const encKey = this.request.clientMetadata.jwks.keys.find(
			(k: Record<string, unknown>) => k.use === 'enc',
		);
		if (!encKey) {
			throw new Error('No encryption key found in client_metadata.jwks');
		}

		const alg =
			(encKey.alg as string) ||
			this.request.clientMetadata.authorization_encrypted_response_alg ||
			'ECDH-ES';
		const enc = this.request.clientMetadata.authorization_encrypted_response_enc || 'A128GCM';

		const publicKey = await importJWK(encKey as JWK, alg);

		const jwe = await new EncryptJWT({ vp_token: vpToken })
			.setProtectedHeader({
				alg,
				enc,
				kid: encKey.kid as string | undefined,
			})
			.encrypt(publicKey);

		return jwe;
	}
}
