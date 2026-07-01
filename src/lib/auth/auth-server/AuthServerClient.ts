import axios, { AxiosResponse } from 'axios';
import { jsonStringifyTaggedBinary, transformTaggedResponse } from '@/util';
import {
	LoginBeginResponse,
	LoginBeginResponseSchema,
	LoginFinishResponse,
	LoginFinishResponseSchema,
	RegisterBeginResponse,
	RegisterBeginResponseSchema,
	RegisterFinishResponse,
	RegisterFinishResponseSchema,
} from './resources';
import { TokenResponse, TokenResponseSchema } from '../resources';

export type AuthServerClientOptions = {
	baseUrl: string;
};

export class AuthServerClient {
	#baseUrl: string;

	#pendingTokenRequests = new Map<string, Promise<TokenResponse>>();

	constructor({ baseUrl }: AuthServerClientOptions) {
		this.#baseUrl = baseUrl;
	}

	async loginBegin(
		tenantId: string,
		oidcIdToken?: string,
	): Promise<LoginBeginResponse> {
		const headers: Record<string, string> = {
			'X-Token-Mode': 'session',
			'X-Tenant-ID': tenantId,
		};
		if (oidcIdToken) {
			headers['Authorization'] = `Bearer ${oidcIdToken}`;
		}

		const res = await this.#post(
			'/auth/passkey/login/begin',
			{},
			headers,
		);

		const { success, data } = LoginBeginResponseSchema.safeParse(res.data);
		if (!success) {
			throw new Error('Invalid login begin response');
		}

		return data;
	}

	async loginFinish(
		challengeId: string,
		credential: PublicKeyCredential,
		tenantId: string,
		oidcIdToken?: string,
	): Promise<LoginFinishResponse> {
		const headers: Record<string, string> = {
			'X-Token-Mode': 'session',
			'X-Tenant-ID': tenantId,
		};
		if (oidcIdToken) {
			headers['Authorization'] = `Bearer ${oidcIdToken}`;
		}

		const response = credential.response as AuthenticatorAssertionResponse;

		const res = await this.#post(
			'/auth/passkey/login/finish',
			{
				challengeId,
				credential: {
					type: credential.type,
					id: credential.id,
					rawId: credential.rawId,
					response: {
						authenticatorData: response.authenticatorData,
						clientDataJSON: response.clientDataJSON,
						signature: response.signature,
						userHandle: response.userHandle,
					},
					authenticatorAttachment: credential.authenticatorAttachment,
					clientExtensionResults: credential.getClientExtensionResults(),
				},
			},
			headers,
		);

		const { success, data } = LoginFinishResponseSchema.safeParse(res.data);
		if (!success) {
			throw new Error('Invalid login finish response');
		}

		return data;
	}

	async registerBegin(
		tenantId: string,
		inviteCode?: string,
		oidcIdToken?: string,
	): Promise<RegisterBeginResponse> {
		const headers: Record<string, string> = {
			'X-Token-Mode': 'session',
			'X-Tenant-ID': tenantId,
		};
		if (oidcIdToken) {
			headers['Authorization'] = `Bearer ${oidcIdToken}`;
		}

		const res = await this.#post(
			'/auth/passkey/register/begin',
			{ tenantId, inviteCode },
			headers,
		);

		const { success, data } = RegisterBeginResponseSchema.safeParse(res.data);
		if (!success) {
			throw new Error('Invalid register begin response');
		}

		return data;
	}

	async registerFinish(
		challengeId: string,
		credential: PublicKeyCredential,
		displayName: string,
		privateData: unknown,
		tenantId: string,
		oidcIdToken?: string,
	): Promise<RegisterFinishResponse> {
		const headers: Record<string, string> = {
			'X-Token-Mode': 'session',
			'X-Tenant-ID': tenantId,
		};
		if (oidcIdToken) {
			headers['Authorization'] = `Bearer ${oidcIdToken}`;
		}

		const response = credential.response as AuthenticatorAttestationResponse;

		const res = await this.#post(
			'/auth/passkey/register/finish',
			{
				challengeId,
				displayName,
				privateData,
				credential: {
					type: credential.type,
					id: credential.id,
					rawId: credential.rawId,
					response: {
						attestationObject: response.attestationObject,
						clientDataJSON: response.clientDataJSON,
					},
					authenticatorAttachment: credential.authenticatorAttachment,
					clientExtensionResults: credential.getClientExtensionResults(),
				},
			},
			headers,
		);

		const { success, data } = RegisterFinishResponseSchema.safeParse(res.data);
		if (!success) {
			throw new Error('Invalid register finish response');
		}

		return data;
	}

	async requestAccessToken(aud: string, tenantId: string, tac?: string): Promise<TokenResponse> {
		const key = `${tenantId}::${aud}::${tac ?? ''}`;
		if (this.#pendingTokenRequests.has(key)) {
			return this.#pendingTokenRequests.get(key)!;
		}

		const request = (async () => {
			const res = await this.#post(
				'/auth/token',
				{ aud, tac, tenant_id: tenantId },
				{ 'X-Token-Mode': 'session' },
			);

			const { success, data } = TokenResponseSchema.safeParse(res.data);
			if (!success) {
				throw new Error('Invalid token endpoint response');
			}

			return data;
		})();

		this.#pendingTokenRequests.set(key, request);
		try {
			return await request;
		} finally {
			this.#pendingTokenRequests.delete(key);
		}
	}

	async logout(): Promise<void> {
		await axios.delete(this.#url('/auth/session'), {
			withCredentials: true,
		});
	}

	async #post(
		path: string,
		body: object,
		headers: Record<string, string> = {},
	): Promise<AxiosResponse> {
		return axios.post(this.#url(path), body, {
			headers: { 'Content-Type': 'application/json', ...headers },
			withCredentials: true,
			transformRequest: (data) => jsonStringifyTaggedBinary(data),
			transformResponse: transformTaggedResponse,
		});
	}


	#url(path: string): string {
		return new URL(path, this.#baseUrl).toString();
	}
}
