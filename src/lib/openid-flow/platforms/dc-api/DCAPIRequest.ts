import {
	decodeProtectedHeader,
	importJWK,
	importX509,
	jwtVerify,
	KeyLike,
	JWK,
	decodeJwt,
} from 'jose';
import {
	KeyMaterial,
	KeyMaterialSchema,
	SignedDCAPIRequest,
	SignedDCApiRequestSchema,
	UnsignedDCAPIRequest,
	UnsignedDCApiRequestSchema
} from './resources';
import { logger } from '@/logger';
import { getPublicKeyFromB64Cert } from '@/lib/utils/pki';

const SUPPORTED_ALGS = new Set([
	'ES256',
	'ES384',
	'ES512',
	'RS256',
	'RS384',
	'RS512',
	'PS256',
	'PS384',
	'PS512'
]);

export class DCAPIRequest {
	readonly data: SignedDCAPIRequest | UnsignedDCAPIRequest;
	readonly isSigned: boolean;

	get nonce() {
		return this.data.nonce;
	}

	get dcqlQuery() {
		return this.data.dcqlQuery;
	}

	get responseMode() {
		return this.data.responseMode;
	}

	get clientId() {
		return this.isSigned
			? (this.data as SignedDCAPIRequest).clientId
			: undefined;
	}

	get expectedOrigins() {
		return this.isSigned
			? (this.data as SignedDCAPIRequest).expectedOrigins
			: undefined;
	}

	get clientMetadata() {
		return this.isSigned
			? (this.data as SignedDCAPIRequest).clientMetadata
			: undefined;
	}

	get keyMaterial() {
		return this.isSigned
			? (this.data as SignedDCAPIRequest).keyMaterial
			: undefined;
	}

	public constructor(url: URL) {
		const requestJwt = url.searchParams.get('request');

		this.data = requestJwt
			? this.#parseJwt(requestJwt, url)
			: this.#parsePlainParams(url);
		this.isSigned = 'rawJwt' in this.data;
	}

	/**
	 * Verify the signature of the request if it is signed.
	 * This should be called before any trust evaluation to ensure the integrity of the request data.
	 * @throws Error if the JWT is invalid or the signature verification fails
	 */
	async verifySignature(): Promise<void> {
		if (!this.isSigned) return;
		await this.#verifyJwtSignature();
	}

	#parseJwt(jwt: string, url: URL): SignedDCAPIRequest {
		const urlClientId = url.searchParams.get('client_id');
		if (!urlClientId) {
			throw new Error('client_id required in URL for signed requests');
		}

		const header = decodeProtectedHeader(jwt);
		const payload = decodeJwt(jwt);

		if (header.typ !== 'oauth-authz-req+jwt') {
			throw new Error("Invalid JWT payload type, must be 'oauth-authz-req+jwt'");
		}

		if (payload.iss) {
			logger.warn("JWT 'iss' claim is not supported and will be ignored");
		}

		if ('transaction_data' in payload) {
			// TODO: implement transaction_data support.
			logger.warn('transaction_data parameter in JWT payload is not yet supported and will be ignored');
		}

		const keyMaterial = this.#extractKeyMaterial(header);
		if (!keyMaterial) {
			throw new Error('JWT header must contain jwk, x5c, or kid for signature verification');
		}

		const { success, data, error } = SignedDCApiRequestSchema.safeParse({
			nonce: payload.nonce,
			dcqlQuery: payload.dcql_query,
			responseMode: payload.response_mode,
			clientId: payload.client_id,
			keyMaterial: keyMaterial,
			rawJwt: jwt,
			expectedOrigins: payload.expected_origins,
			clientMetadata: payload.client_metadata,
		});
		if (!success) {
			logger.error('Invalid DC API JWT request:', error);
			throw new Error('Invalid DC API JWT request: ' + error.errors.map(e => e.message).join(', '));
		}

		if (urlClientId !== data.clientId) {
			throw new Error('client_id mismatch between URL and JWT');
		}

		return data;
	}

	#parsePlainParams(url: URL): UnsignedDCAPIRequest {
		if ('transaction_data' in url.searchParams) {
			// TODO: implement transaction_data support.
			logger.warn('transaction_data parameter in query string is not yet supported and will be ignored');
		}

		const dcqlQueryParam = (() => {
			try {
				return JSON.parse(url.searchParams.get('dcql_query') || '{}');
			} catch {
				throw new Error('Invalid JSON in dcql_query parameter');
			}
		})();

		const { success, data, error } = UnsignedDCApiRequestSchema.safeParse({
			nonce: url.searchParams.get('nonce'),
			dcqlQuery: dcqlQueryParam,
			responseMode: url.searchParams.get('response_mode') ?? undefined,
		});

		if (!success) {
			logger.error('Invalid DC API request parameters:', error);
			throw new Error('Invalid DC API request parameters: ' + error.errors.map(e => e.message).join(', '));
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
	 * @throws Error if the JWT is invalid or the signature verification fails
	 */
	async #verifyJwtSignature(): Promise<void> {
		if (!('rawJwt' in this.data) || !('keyMaterial' in this.data)) return;

		const { type, value } = this.data.keyMaterial;
		let publicKey: KeyLike | Uint8Array;

		const alg = this.#getJwtAlg();
		logger.debug('[DCAPIRequest] JWT algorithm:', alg);
		logger.debug('[DCAPIRequest] Key material type:', type);

		switch (type) {
			case 'x5c': {
				const certs = value as string[];
				logger.debug('[DCAPIRequest] Importing x5c certificate, chain length:', certs.length);
				const pem = getPublicKeyFromB64Cert(certs[0]);
				publicKey = await importX509(pem, alg);
				logger.debug('[DCAPIRequest] x5c key imported successfully');
				break;
			}
			case 'jwk': {
				logger.debug('[DCAPIRequest] Importing JWK:', JSON.stringify(value));
				publicKey = await importJWK(value as JWK, alg);
				logger.debug('[DCAPIRequest] JWK imported successfully');
				break;
			}
			case 'kid':
				logger.debug('[DCAPIRequest] kid-only key material, deferring to trust layer');
				return;
			default:
				throw new Error(`Unsupported key material type: ${type}`);
		}

		try {
			logger.debug('[DCAPIRequest] Verifying JWT with imported key...');
			await jwtVerify(this.data.rawJwt, publicKey);
			logger.debug('[DCAPIRequest] JWT signature valid');
		} catch (err) {
			logger.error('[DCAPIRequest] JWT signature verification failed:', err);
			throw new Error(`JWT signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	#getJwtAlg(): string {
		if (!('rawJwt' in this.data)) {
			throw new Error('Cannot determine JWT alg: request is not signed');
		}

		const header = decodeProtectedHeader(this.data.rawJwt);
		const alg = header.alg ?? 'ES256';

		if (!SUPPORTED_ALGS.has(alg)) {
			throw new Error(`Unsupported JWT algorithm: ${alg}`);
		}

		return alg;
	}
}
