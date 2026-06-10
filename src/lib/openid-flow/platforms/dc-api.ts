import type { DcqlQuery } from 'dcql';
import { getPublicKeyFromB64Cert } from '@/lib/utils/pki';
import { importJWK, importX509, JWK, jwtVerify, KeyLike } from 'jose';
import { logger } from '@/logger';

type DCAPIMode = 'wallet_companion' | 'android' | 'ios';

export type SignedDCAPIRequest = {
	clientId: string;
	nonce: string;
	dcqlQuery: DcqlQuery.Input;
	keyMaterial?: {
		type: 'x5c' | 'jwk' | 'kid';
		value: unknown;
	};
	rawJwt: string;
	expectedOrigins: string[];
};

export type UnsignedDCAPIRequest = {
	nonce: string;
	dcqlQuery: DcqlQuery.Input;
};

export type DCAPIRequest =
	| SignedDCAPIRequest
	| UnsignedDCAPIRequest;

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

	public sendResponse(vpToken: Record<string, string[]>): void {
		switch (this.mode) {
			case 'wallet_companion':
				this.#sendWalletCompanionMessage({ vp_token: vpToken });
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

	#sendWalletCompanionMessage(payload: { vp_token?: Record<string, string[]>; error?: string }): void {
		if (!window.opener) throw new Error('No opener window');
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');

		window.opener.postMessage({
			type: 'WC_WALLET_RESPONSE',
			requestId: this.requestId,
			...(payload.error ? { error: payload.error } : { response: payload }),
		}, this.#verifiedOrigin);
	}

	#parsePlainParams(url: URL): UnsignedDCAPIRequest {
		const rawQuery = url.searchParams.get('dcql_query');
		if (!rawQuery) throw new Error('Missing dcql_query');

		const nonce = url.searchParams.get('nonce');
		if (!nonce || typeof nonce !== 'string') throw new Error('Invalid or missing nonce');

		return {
			nonce,
			dcqlQuery: JSON.parse(rawQuery),
		};
	}

	#parseJwtRequest(jwt: string, url: URL): SignedDCAPIRequest {
		const [headerB64, payloadB64] = jwt.split('.');
		const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
		const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

		const clientId = payload.client_id;
		if (!clientId || typeof clientId !== 'string') {
			throw new Error('Invalid or missing client_id in JWT payload');
		}
		if (clientId !== url.searchParams.get('client_id')) {
			throw new Error('client_id mismatch between JWT payload and URL parameter');
		}

		const nonce = payload.nonce;
		if (!nonce || typeof nonce !== 'string') {
			throw new Error('Invalid or missing nonce in JWT payload');
		}

		let dcqlQuery = payload.dcql_query;
		if (!dcqlQuery) {
			throw new Error('Missing dcql_query in JWT payload');
		}
		if (typeof dcqlQuery === 'string') {
			try {
				dcqlQuery = JSON.parse(dcqlQuery);
			} catch (err) {
				throw new Error('Invalid dcql_query format in JWT payload');
			}
		}
		if (typeof dcqlQuery !== 'object') {
			throw new Error('Invalid dcql_query type in JWT payload');
		}

		const expectedOrigins = payload.expected_origins;
		if (expectedOrigins && !Array.isArray(expectedOrigins)) {
			throw new Error('expected_origins must be an array');
		}

		return {
			clientId,
			nonce,
			dcqlQuery,
			expectedOrigins,
			keyMaterial: this.#extractKeyMaterial(header),
			rawJwt: jwt,
		};
	}

	#extractKeyMaterial(header: Record<string, unknown>) {
		if (header.x5c && Array.isArray(header.x5c)) {
			return { type: 'x5c' as const, value: header.x5c };
		}
		if (header.jwk) {
			return { type: 'jwk' as const, value: header.jwk };
		}
		if (header.kid && typeof header.kid === 'string') {
			return { type: 'kid' as const, value: header.kid };
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
}
