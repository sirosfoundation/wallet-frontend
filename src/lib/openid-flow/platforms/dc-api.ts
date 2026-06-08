import type { DcqlQuery } from 'dcql';

type DCAPIMode = 'wallet_companion' | 'android' | 'ios';

export type DCAPIRequest = {
	clientId: string;
	responseUri: string;
	nonce?: string;
	dcqlQuery: DcqlQuery.Input;
	keyMaterial?: {
		type: 'x5c' | 'jwk' | 'kid';
		value: unknown;
	};
	rawJwt?: string; // For signature verification
};

export class DCAPISession {
	readonly request: DCAPIRequest;
	readonly requestId: string;
	readonly mode: DCAPIMode;

	constructor(url: URL) {
		this.requestId = url.searchParams.get('request_id') ?? '';
		this.mode = this.#detectMode();

		if (!this.requestId) throw new Error('Missing request_id');

		const requestJwt = url.searchParams.get('request');
		if (requestJwt) {
			this.request = this.#parseJwtRequest(requestJwt, url);
		} else {
			this.request = this.#parsePlainParams(url);
		}

		if (!this.request.dcqlQuery.credentials?.length) {
			throw new Error('No credentials in DCQL query');
		}
	}

	#detectMode(): DCAPIMode {
		if (window.opener) {
			return 'wallet_companion';
		}

		throw new Error('Unable to detect DC API mode, no supported environment detected');
	}

	sendResponse(vpToken: Record<string, string[]>): void {
		switch (this.mode) {
			case 'wallet_companion':
				this.#sendWalletCompanionMessage({ vp_token: vpToken });
				this.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	sendError(error: string): void {
		switch (this.mode) {
			case 'wallet_companion':
				this.#sendWalletCompanionMessage({ error });
				this.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	close(): void {
		switch (this.mode) {
			case 'wallet_companion':
				window.close();
				break;
			default:
				throw new Error(`${this.mode} not yet implemented`);
		}
	}

	#sendWalletCompanionMessage(payload: { vp_token?: Record<string, string[]>; error?: string }): void {
		if (!window.opener) throw new Error('No opener window');
		window.opener.postMessage({
			type: 'WC_WALLET_RESPONSE',
			requestId: this.requestId,
			...(payload.error ? { error: payload.error } : { response: payload }),
		}, new URL(this.request.responseUri).origin);
	}

	#parsePlainParams(url: URL): DCAPIRequest {
		const rawQuery = url.searchParams.get('dcql_query');
		if (!rawQuery) throw new Error('Missing dcql_query');

		return {
			clientId: url.searchParams.get('client_id') ?? '',
			responseUri: url.searchParams.get('response_uri') ?? '',
			nonce: url.searchParams.get('nonce') ?? undefined,
			dcqlQuery: JSON.parse(rawQuery) as DcqlQuery.Input,
		};
	}

	/**
	 * @todo we currently don't verify the JWT signature, which we should do.
	 */
	#parseJwtRequest(jwt: string, url: URL): DCAPIRequest {
		const [headerB64, payloadB64] = jwt.split('.');
		const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
		const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

		// Verify client_id matches URL param per RFC 9101
		const urlClientId = url.searchParams.get('client_id');
		if (urlClientId && payload.client_id && urlClientId !== payload.client_id) {
			throw new Error('client_id mismatch between URL and JWT');
		}

		return {
			clientId: payload.client_id ?? urlClientId ?? '',
			responseUri: payload.response_uri ?? payload.redirect_uri ?? '',
			nonce: payload.nonce ?? undefined,
			dcqlQuery: payload.dcql_query as DcqlQuery.Input,
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
}
