import { logger } from '@/logger';
import { BACKEND_URL } from '@/config';
import HttpClient from '@/lib/services/HttpClient';
import type { AccessTokenInterface } from './types';
import { AccessToken } from './AccessToken';
import { AuthError, TokenResponseSchema } from '../resources';

type AuthTokensOptions = {
	httpClient: HttpClient,
	tenantId: string;
}

export class AuthTokens {
	#tenantId: string;
	#httpClient: HttpClient;

	/**
	 * Manifest of available auth tokens.
	 * These are the kinds of tokens that the frontend
	 * expects to be able to request from the backend.
	 */
	static readonly MANIFEST = {
		'backend': {
			audience: 'wallet-backend',
			tac: 'rwlid',
		},
		'anonymous': {
			audience: 'wallet-backend',
			tac: 'rl'
		},
	}

	#tokens = new Map<string, AccessTokenInterface>();

	constructor({ httpClient, tenantId }: AuthTokensOptions) {
		this.#httpClient = httpClient;
		this.#tenantId = tenantId;
	}

	/**
	 * Load auth tokens from local storage and return an AuthTokens instance.
	 */
	static fromStorage(options: AuthTokensOptions): AuthTokens {
		const session = new AuthTokens(options);
		session.#loadTokensFromStorage();
		return session;
	}

	public async ensureBackendToken(): Promise<AccessTokenInterface> {
		return this.ensureToken('backend');
	}

	public async ensureAnonymousToken(): Promise<AccessTokenInterface> {
		return this.ensureToken('anonymous');
	}

	async ensureToken(name: keyof typeof AuthTokens.MANIFEST): Promise<AccessTokenInterface> {
		const existing = this.#tokens.get(name);
		if (existing && !existing.isExpired()) return existing;

		const token = await this.#requestAccessToken(AuthTokens.MANIFEST[name]);
		this.#tokens.set(name, token);
		this.#storeToken(name, token);
		return token;
	}

	async clear(): Promise<void> {
		for (const name of this.#tokens.keys()) {
			localStorage.removeItem(`authToken:${name}`);
		}
		this.#tokens.clear();
	}

	async #requestAccessToken(options: {
		audience: string;
		tac?: string;
	}): Promise<AccessTokenInterface> {
		const res = await this.#httpClient.post(
			new URL('/auth/token', BACKEND_URL).toString(),
			{
				aud: options.audience,
				tac: options.tac,
				tenant_id: this.#tenantId,
			},
			{},
			{
				useCache: false,
			});

		const parsed = TokenResponseSchema.safeParse(res.data);
		if (!parsed.success) {
			throw new AuthError('Invalid token endpoint response');
		}

		return new AccessToken(parsed.data.access_token);
	}

	#loadTokensFromStorage(): void {
		for (const name of Object.keys(AuthTokens.MANIFEST)) {
			const jwt = localStorage.getItem(`authToken:${name}`);
			if (!jwt) continue;
			try {
				this.#tokens.set(name, new AccessToken(jwt));
			} catch {
				logger.error(`Failed to parse access token: ${name}`)
			}
		}
	}

	#storeToken(tokenId: string, token: AccessTokenInterface): void {
		localStorage.setItem(`authToken:${tokenId}`, token.raw);
	}
}
