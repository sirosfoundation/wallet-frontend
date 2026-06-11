import { DCAPIMode, DCAPIResponse } from "./resources";

export class DCAPIWalletCompanionMode implements DCAPIMode {
	#verifiedOrigin: string;

	get verifiedOrigin(): string {
		return this.#verifiedOrigin;
	}

	async originHandshake(requestId: string, expectedOrigins?: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Origin handshake timeout')), 5000);

			const handler = (event: MessageEvent) => {
				if (event.data?.type === 'WC_ORIGIN_ACK' && event.data.requestId === requestId) {
					clearTimeout(timeout);
					window.removeEventListener('message', handler);

					if (expectedOrigins && !expectedOrigins.includes(event.origin)) {
						return reject(new Error(`Origin ${event.origin} not in expected_origins`));
					}

					this.#verifiedOrigin = event.origin;
					resolve(event.origin);
				}
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
			message.response = payload.response;
		} else if (payload.vp_token) {
			message.response = { vp_token: payload.vp_token };
		}

		window.opener.postMessage(message, this.#verifiedOrigin);
	}

	close(): void {
		window.close();
	}
}
