import { getPublicKeyFromB64Cert } from '@/lib/utils/pki';
import { calculateJwkThumbprint, EncryptJWT, importJWK, importX509, JWK, jwtVerify, KeyLike } from 'jose';
import { logger } from '@/logger';
import { z } from 'zod';

type DCAPIMode = 'wallet_companion' | 'android' | 'ios';

const DCApiResponseModeSchema = z
	.enum(['dc_api', 'dc_api.jwt'], {
		errorMap: () => ({ message: "response_mode must be 'dc_api' or 'dc_api.jwt'" }),
	})
	.default('dc_api');

const KeyMaterialSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('x5c'), value: z.array(z.string()) }),
	z.object({ type: z.literal('jwk'), value: z.object({}).passthrough() }),
	z.object({ type: z.literal('kid'), value: z.string() }),
]);

type KeyMaterial = z.infer<typeof KeyMaterialSchema>;

const ClientMetadataSchema = z.object({
	jwks: z.object({
		keys: z.array(z.object({}).passthrough()),
	}).optional(),
	authorization_encrypted_response_alg: z.string().optional(),
	authorization_encrypted_response_enc: z.string().optional(),
}).passthrough();

const BaseDCApiRequestSchema = z.object({
	nonce: z.string({ required_error: 'Missing required nonce parameter' }).min(1, 'nonce cannot be empty'),
	dcqlQuery: z.object({
		credentials: z.array(
			z.object({}).passthrough(), { required_error: 'Missing credentials array in dcql_query' }
		).min(1, 'credentials array cannot be empty'),
		credential_sets: z.array(
			z.object({}).passthrough()
		).optional(),
	}, { required_error: 'Invalid or missing dcql_query parameter' }).passthrough(),
	responseMode: DCApiResponseModeSchema,
}).strict();

const SignedDCApiRequestSchema = BaseDCApiRequestSchema.extend({
	clientId: z.string({ required_error: 'Missing client_id in JWT payload' }).min(1, 'client_id cannot be empty'),
	keyMaterial: KeyMaterialSchema,
	rawJwt: z.string().min(1),
	expectedOrigins: z.array(z.string(), { required_error: 'Missing expected_origins in signed request' }),
	clientMetadata: ClientMetadataSchema.optional(),
}).strict();

const UnsignedDCApiRequestSchema = BaseDCApiRequestSchema;

export type SignedDCAPIRequest = z.infer<typeof SignedDCApiRequestSchema>;
export type UnsignedDCAPIRequest = z.infer<typeof UnsignedDCApiRequestSchema>;
export type DCAPIRequest = SignedDCAPIRequest | UnsignedDCAPIRequest;

export class DCAPISession {
	readonly request: DCAPIRequest;
	readonly requestId: string;
	readonly mode: DCAPIMode;
	#verifiedOrigin?: string;

	constructor(url: URL) {
		this.requestId = url.searchParams.get('request_id');
		this.mode = this.#detectMode();

		if (!this.requestId) throw new Error('Missing request_id');

		const requestJwt = url.searchParams.get('request');
		this.request = requestJwt
			? this.#parseJwtRequest(requestJwt, url)
			: this.#parsePlainParams(url);

	}

	async initialize(): Promise<void> {
		if (!this.request.dcqlQuery?.credentials?.length) {
			throw new Error('No credentials in DCQL query');
		}
		if (!this.request.nonce) {
			throw new Error('Missing required nonce parameter for DC API request');
		}

		if ('rawJwt' in this.request && 'keyMaterial' in this.request) {
			await this.#verifyJwtSignature();
		}

		if (this.mode === 'wallet_companion') {
			await this.#performWalletCompanionOriginHandshake();
		}

		if ('rawJwt' in this.request && !this.request.expectedOrigins?.length) {
			throw new Error('Signed request missing required expected_origins');
		}
		if ('expectedOrigins' in this.request) {
			if (!this.#verifiedOrigin) {
				throw new Error('Cannot validate expected_origins: origin not verified');
			}
			if (!this.request.expectedOrigins.includes(this.#verifiedOrigin)) {
				throw new Error(`Origin ${this.#verifiedOrigin} not in expected_origins`);
			}
		}
	}

	get verifiedOrigin(): string | undefined {
		return this.#verifiedOrigin;
	}

	public async verifierJwkThumbprint(): Promise<string | null> {
		if (this.request.responseMode !== 'dc_api.jwt') return null;
		if (!('clientMetadata' in this.request)) return null;

		const encKey = this.request.clientMetadata?.jwks?.keys?.find(
			(k: Record<string, unknown>) => k.use === 'enc'
		);
		if (!encKey) return null;

		return await calculateJwkThumbprint(encKey as JWK, 'sha256');
	}

	public async sendResponse(vpToken: Record<string, string[]>): Promise<void> {
		const payload = this.request.responseMode === 'dc_api.jwt'
			? { response: await this.#encryptResponse(vpToken) }
			: { vp_token: vpToken };

		switch (this.mode) {
			case 'wallet_companion':
				this.#sendWalletCompanionMessage(payload);
				this.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	public sendErrorAndClose(error: string): void {
		switch (this.mode) {
			case 'wallet_companion':
				this.#sendWalletCompanionMessage({ error });
				this.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	public close(): void {
		switch (this.mode) {
			case 'wallet_companion':
				window.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	#detectMode(): DCAPIMode {
		if (window.opener) {
			return 'wallet_companion';
		}

		throw new Error('Unable to detect DC API mode, no supported environment detected');
	}

	async #performWalletCompanionOriginHandshake(): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Origin handshake timeout')), 5000);

			const handler = (event: MessageEvent) => {
				if (event.data?.type === 'WC_ORIGIN_ACK' && event.data.requestId === this.requestId) {
					clearTimeout(timeout);
					window.removeEventListener('message', handler);

					this.#verifiedOrigin = event.origin;
					resolve();
				}
			};

			window.addEventListener('message', handler);
			window.opener.postMessage({ type: 'WC_ORIGIN_CHECK', requestId: this.requestId }, '*');
		});
	}

	#sendWalletCompanionMessage(payload: { vp_token?: Record<string, string[]>; response?: string; error?: string }): void {
		if (!window.opener) throw new Error('No opener window');
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');

		const message: Record<string, unknown> = {
			type: 'WC_WALLET_RESPONSE',
			requestId: this.requestId,
		};

		if (payload.error) {
			message.error = payload.error;
		} else if (payload.response) {
			message.response = payload.response;
		} else if (payload.vp_token) {
			message.response = { vp_token: payload.vp_token };
		}

		window.opener.postMessage(message, this.#verifiedOrigin);
	}

	#parsePlainParams(url: URL): UnsignedDCAPIRequest {
		const { success, data, error } = UnsignedDCApiRequestSchema.safeParse({
			nonce: url.searchParams.get('nonce'),
			dcqlQuery: url.searchParams.get('dc_query'),
			responseMode: url.searchParams.get('response_mode'),
		});

		if (!success) {
			logger.error('Invalid DC API request parameters:', error);
			throw new Error('Invalid DC API request parameters: ' + error.errors.map(e => e.message).join(', '));
		}

		return data;
	}

	#parseJwtRequest(jwt: string, url: URL): SignedDCAPIRequest {
		const [headerB64, payloadB64] = jwt.split('.');
		const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
		const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

		const { success, data, error } = SignedDCApiRequestSchema.safeParse({
			nonce: payload.nonce,
			dcqlQuery: payload.dcql_query,
			responseMode: payload.response_mode,
			clientId: payload.client_id,
			keyMaterial: this.#extractKeyMaterial(header),
			rawJwt: jwt,
			expectedOrigins: payload.expected_origins,
			clientMetadata: payload.client_metadata,
		});
		if (!success) {
			logger.error('Invalid DC API JWT request:', error);
			throw new Error('Invalid DC API JWT request: ' + error.errors.map(e => e.message).join(', '));
		}

		return data;
	}

	#extractKeyMaterial(header: Record<string, unknown>): KeyMaterial | undefined {
		if (header.x5c && Array.isArray(header.x5c)) {
			const result = KeyMaterialSchema.safeParse({ type: 'x5c', value: header.x5c });
			if (result.success) return result.data;
		}

		if (header.jwk && typeof header.jwk === 'object' && header.jwk !== null) {
			const result = KeyMaterialSchema.safeParse({ type: 'jwk', value: header.jwk });
			if (result.success) return result.data;
		}

		if (header.kid && typeof header.kid === 'string') {
			const result = KeyMaterialSchema.safeParse({ type: 'kid', value: header.kid });
			if (result.success) return result.data;
		}

		return undefined;
	}

	/**
	 * Verify that the JWT has a valid signature using it's own key material.
	 * It is **not** sufficient for a trust decision, but ensures the JWT is well-formed
	 * and signed by the holder of the key material before we perform the actual trust evaluation.
	 */
	async #verifyJwtSignature(): Promise<void> {
		if (!('rawJwt' in this.request) || !('keyMaterial' in this.request)) return;

		const { type, value } = this.request.keyMaterial;
		let publicKey: KeyLike | Uint8Array;

		const alg = this.#getJwtAlg();
		logger.debug('[DCAPISession] JWT algorithm:', alg);
		logger.debug('[DCAPISession] Key material type:', type);

		switch (type) {
			case 'x5c': {
				const certs = value as string[];
				logger.debug('[DCAPISession] Importing x5c certificate, chain length:', certs.length);
				const pem = getPublicKeyFromB64Cert(certs[0]);
				publicKey = await importX509(pem, alg);
				logger.debug('[DCAPISession] x5c key imported successfully');
				break;
			}
			case 'jwk': {
				logger.debug('[DCAPISession] Importing JWK:', JSON.stringify(value));
				publicKey = await importJWK(value as JWK, alg);
				logger.debug('[DCAPISession] JWK imported successfully');
				break;
			}
			case 'kid':
				logger.debug('[DCAPISession] kid-only key material, deferring to trust layer');
				return;
			default:
				throw new Error(`Unsupported key material type: ${type}`);
		}

		try {
			logger.debug('[DCAPISession] Verifying JWT with imported key...');
			await jwtVerify(this.request.rawJwt, publicKey);
			logger.debug('[DCAPISession] JWT signature valid');
		} catch (err) {
			logger.error('[DCAPISession] JWT signature verification failed:', err);
			throw new Error(`JWT signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	#getJwtAlg(): string {
		if (!('rawJwt' in this.request)) {
			throw new Error('Cannot determine JWT alg: request is not signed');
		}

		const [headerB64] = this.request.rawJwt.split('.');
		const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
		return header.alg ?? 'ES256';
	}

	async #encryptResponse(vpToken: Record<string, string[]>): Promise<string> {
		if (!('clientMetadata' in this.request) || !this.request.clientMetadata?.jwks?.keys?.length) {
			throw new Error('dc_api.jwt response_mode requires client_metadata.jwks');
		}

		// Find encryption key (use='enc')
		const encKey = this.request.clientMetadata.jwks.keys.find(
			(k: Record<string, unknown>) => k.use === 'enc'
		);
		if (!encKey) {
			throw new Error('No encryption key found in client_metadata.jwks');
		}

		const alg = (encKey.alg as string)
			|| this.request.clientMetadata.authorization_encrypted_response_alg
			|| 'ECDH-ES';
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
