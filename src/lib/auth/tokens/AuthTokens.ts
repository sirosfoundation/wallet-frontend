import { logger } from '@/logger';
import type { AccessTokenInterface } from './types';
import { AccessToken } from './AccessToken';
import { AuthServerClient } from '../auth-server/AuthServerClient';

type AuthTokensOptions = {
	authServerClient: AuthServerClient,
	tenantId: string;
}

export class AuthTokens {
	#tenantId: string;
	#authServerClient: AuthServerClient;

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

	constructor({ authServerClient, tenantId }: AuthTokensOptions) {
		this.#authServerClient = authServerClient;
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
		const data = await this.#authServerClient.requestAccessToken(
			options.audience,
			this.#tenantId,
			options.tac,
		);

		return new AccessToken(data.access_token);
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
