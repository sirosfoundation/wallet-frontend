import { AccessTokenPayloadSchema, AuthError } from '../resources';
import { AccessTokenInterface, Acr, Tac } from './types';

export class AccessToken implements AccessTokenInterface {
	public readonly raw: string;
	public readonly sub: string;
	public readonly aud: string;
	public readonly tenantId: string;
	public readonly tac: Tac;
	public readonly acr: Acr;
	public readonly expiresAt: Date;

	constructor(jwt: string) {
		const { success, data: payload } = AccessTokenPayloadSchema.safeParse(
			AccessToken.#parseJwt(jwt)
		);

		if (!success) {
			throw new AuthError('Failed to parse access token');
		}

		this.raw = jwt;
		this.sub = payload.sub;
		this.aud = payload.aud;
		this.tenantId = payload.tenant_id;
		this.tac = new Set(payload.tac.split('')) as Tac;
		this.acr = payload.acr;
		this.expiresAt = new Date(payload.exp * 1000);
	}

	isExpired(): boolean {
		return Date.now() >= this.expiresAt.getTime() - 10_000;
	}

	token(): string {
		return this.raw;
	}

	static #parseJwt(raw: string) {
		try {
			const base64 = raw.split('.')[1];
			const json = atob(base64.replaceAll('-', '+').replaceAll('_', '/'));
			return JSON.parse(json);
		} catch {
			throw new AuthError('Failed to parse access token');
		}
	}
}
