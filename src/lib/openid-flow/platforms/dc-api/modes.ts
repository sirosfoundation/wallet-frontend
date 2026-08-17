import { DCAPIEnvelope, DCAPIMode, DCAPIRequestProtocol, DCAPIRequestProtocolSchema, DCAPIResponse } from './resources';

export class DCAPIWalletCompanionMode implements DCAPIMode {
	#verifiedOrigin?: string;

	get verifiedOrigin(): string {
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');
		return this.#verifiedOrigin;
	}

	async initialize(envelope: DCAPIEnvelope): Promise<void> {
		// no-op for now
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

		const message = responseToMessage(response);
		message.type = 'WC_WALLET_RESPONSE';

		window.opener.postMessage(message, this.#verifiedOrigin);
	}

	close(): void {
		window.close();
	}
}

export class DCAPINativeMode implements DCAPIMode {
	#verifiedOrigin?: string;
	#requestProtocol?: DCAPIRequestProtocol;

	get verifiedOrigin(): string {
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');
		return this.#verifiedOrigin;
	}

	async initialize(envelope: DCAPIEnvelope): Promise<void> {
		this.#ensureRequestProtocol(envelope.requestProtocol);
	}

	async originHandshake(requestId: string, expectedOrigins?: string[]): Promise<string> {
		if (!window.nativeWrapper) throw new Error('No native wrapper available');

		// The native wrapper app sends the request_origin as a query parameter
		// in the DC API request URL, hence we dont use the requestId.
		// For now, we intercept it here since it's still part of the url,
		// pending furthe negotiation.
		void requestId;

		const requestOrigin = new URLSearchParams(window.location.search)
			.get('request_origin');

		if (!requestOrigin) {
			throw new Error('Missing request_origin parameter in DC API request');
		}

		if (expectedOrigins && !expectedOrigins.includes(requestOrigin)) {
			throw new Error(`Origin ${requestOrigin} not in expected_origins`);
		}

		this.#verifiedOrigin = requestOrigin;
		return requestOrigin;
	}

	public send(response: DCAPIResponse): void {
		if (!window.nativeWrapper) throw new Error('No native wrapper available');

		const protocol = this.#requestProtocol;
		if (!protocol) {
			throw new Error('Request protocol not set in DCAPINativeMode');
		}

		// Right now we don't care about returning the requestId in the response,
		// since the native wrapper doesn't check it.
		const { payload } = response;

		const data = (() => {
			const res: Record<string, unknown> = {};

			if (payload.response) {
				res.response = payload.response;
			} else if (payload.vp_token) {
				res.response = { vp_token: payload.vp_token };
			}

			return res;
		})();

		const errorString = payload.error ? JSON.stringify(payload.error) : undefined;

		const responseString = JSON.stringify({
			protocol,
			data,
		});

		window.nativeWrapper.sendDcApiResponse(responseString, errorString);
	}

	public close(): void {
		throw new Error(
			'DCAPINativeMode.close() should not be called in native mode, as closing happens during DCAPINativeMode.send()'
		);
	}

	#ensureRequestProtocol(expected?: DCAPIRequestProtocol): void {
		if (!expected) {
			throw new Error('Missing request_protocol parameter in DC API request');
		}

		this.#requestProtocol = expected;
	}
}

function responseToMessage(response: DCAPIResponse): Record<string, unknown> {
	const { requestId, payload } = response;

	const message: Record<string, unknown> = {
		requestId,
	};

	if (payload.error) {
		message.error = payload.error;
	} else if (payload.response) {
		message.response = payload.response;
	} else if (payload.vp_token) {
		message.response = { vp_token: payload.vp_token };
	}

	return message;
}
