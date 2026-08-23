import { DCAPIMode, DCAPIResponse } from "./resources";

export class DCAPIWalletCompanionMode implements DCAPIMode {
	#verifiedOrigin?: string;

	get verifiedOrigin(): string {
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');
		return this.#verifiedOrigin;
	}

	async originHandshake(requestId: string, expectedOrigins?: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Origin handshake timeout')), 5000);

			const handler = (event: MessageEvent) => {
				if (
					event.source !== window.opener ||
					event.data?.type !== 'WC_ORIGIN_ACK' ||
					!event.data?.requestId
				) return;

				if (event.data.requestId !== requestId) {
					return reject(new Error('Mismatched requestId in origin handshake response.'));
				}

				clearTimeout(timeout);
				window.removeEventListener('message', handler);

				if (expectedOrigins && !expectedOrigins.includes(event.origin)) {
					return reject(new Error(`Origin ${event.origin} not in expected_origins`));
				}

				this.#verifiedOrigin = event.origin;
				resolve(event.origin);
			};

			window.addEventListener('message', handler);

			// We don't know the opener's origin yet - that's what we're discovering.
			// The probe contains only a request ID; the opener's origin is captured from
			// the ACK response and validated against expectedOrigins before any credentials are sent.
			window.opener.postMessage({ type: 'WC_ORIGIN_CHECK', requestId }, '*');
		});
	}

	send(response: DCAPIResponse): void {
		if (!window.opener) throw new Error('No opener window');
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');

		const { requestId, payload } = response;

		const message: Record<string, unknown> = {
			type: 'WC_WALLET_RESPONSE',
			requestId,
		};

		if (payload.error) {
			message.error = payload.error;
		} else if (payload.response) {
			// dc_api.jwt: payload.response is the bare JWE compact-serialization
			// string produced by DCAPISession#encryptResponse. It must stay
			// wrapped in a { response } envelope here - the OpenID4VP DC API
			// profile and the native mobile SDKs both put the JWE at
			// data.response, not at data directly. Assigning it unwrapped
			// (as this used to) meant the final DigitalCredential.data was a
			// bare JWE string with no .response property to find it under.
			message.response = { response: payload.response };
		} else if (payload.vp_token) {
			// Forward the whole payload (vp_token, and state when the request
			// supplied one) rather than reconstructing a subset - a verifier
			// correlating this response via state would otherwise never see it.
			message.response = payload;
		}

		window.opener.postMessage(message, this.#verifiedOrigin);
	}

	close(): void {
		window.close();
	}
}
