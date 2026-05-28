import type { DcqlQuery } from 'dcql';

type DCAPIMode = 'wallet_companion' | 'android' | 'ios';

export type DCAPIRequest = {
	clientId: string;
	responseUri: string;
	nonce?: string;
	dcqlQuery: DcqlQuery.Input;
};

export class DCAPISession {
	readonly request: DCAPIRequest;
	readonly requestId: string;
	readonly mode: DCAPIMode;

	constructor(url: URL) {
		this.requestId = url.searchParams.get('request_id') ?? '';
		this.request = {
			clientId: url.searchParams.get('client_id') ?? '',
			responseUri: url.searchParams.get('response_uri') ?? '',
			nonce: url.searchParams.get('nonce') ?? undefined,
			dcqlQuery: JSON.parse(url.searchParams.get('dcql_query') ?? '{}') as DcqlQuery.Input,

		};
		this.mode = this.#detectMode();

		if (!this.requestId) throw new Error('Missing request_id');

		const rawQuery = url.searchParams.get('dcql_query');
		if (!rawQuery) throw new Error('Missing dcql_query');

		if (!this.request.dcqlQuery.credentials?.length) throw new Error('No credentials in DCQL query');
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
}
