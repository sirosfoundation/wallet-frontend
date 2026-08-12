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

	get verifiedOrigin(): string {
		if (!this.#verifiedOrigin) throw new Error('Origin not verified');
		return this.#verifiedOrigin;
	}

	async originHandshake(requestId: string, expectedOrigins?: string[]): Promise<string> {
		if (!window.nativeWrapper) throw new Error('No native wrapper available');

		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Origin handshake timeout')), 5000);
		});

		try {
			const origin = await Promise.race([
				window.nativeWrapper.getDCAPIRequestOrigin(requestId),
				timeout,
			]);

			if (!origin) throw new Error('Native wrapper returned empty origin');

			if (expectedOrigins && !expectedOrigins.includes(origin)) {
				throw new Error(`Origin ${origin} not in expected_origins`);
			}

			this.#verifiedOrigin = origin;
			return origin;
		} finally {
			clearTimeout(timer);
		}
	}

	public send(response: DCAPIResponse): void {
		if (!window.nativeWrapper) throw new Error('No native wrapper available');

		const message = responseToMessage(response);

		window.nativeWrapper.sendDCAPIResponse(message);
	}

	public close(): void {
		if (!window.nativeWrapper) throw new Error('No native wrapper available');
		window.nativeWrapper.sendDCAPIResponse({});
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
