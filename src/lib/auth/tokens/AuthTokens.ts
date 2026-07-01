import { logger } from '@/logger';
import type { AccessTokenInterface, TokenRejectionInfo, TokenRejectionListener } from './types';
import { AccessToken } from './AccessToken';
import { AuthServerClient } from '../auth-server/AuthServerClient';

type AuthTokensOptions = {
	authServerClient: AuthServerClient,
	tenantId: string;
}

type AuthTokensManifest = typeof AuthTokens.MANIFEST;

export class AuthTokens {
	#tenantId: string;
	#authServerClient: AuthServerClient;

	#rejectionListeners = new Set<TokenRejectionListener<keyof AuthTokensManifest>>();
	#rejectionTimes = new Map<keyof AuthTokensManifest, number[]>();
	#rejectionWindowMs = 60 * 1000;
	#maxRejections = 3;

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
			tac: 'rl',
			anonymous: true,
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

	/**
	 * Register a listener for token rejection events.
	 * The listener will be called with the token name and rejection count.
	 * Returns a function to unregister the listener.
	 */
	public onTokenRejection(listener: TokenRejectionListener<keyof AuthTokensManifest>): () => void {
		this.#rejectionListeners.add(listener);
		return () => this.#rejectionListeners.delete(listener);
	}

	/**
	 * Report that the token with the given name was rejected by a consuming service
	 * (e.g. engine WS handshake, resolve API or metadata registry).
	 */
	public registerTokenRejection(name: keyof AuthTokensManifest): boolean {
		const now = Date.now();
		const times = (this.#rejectionTimes.get(name) ?? [])
			.filter(t => now - t < this.#rejectionWindowMs);
		times.push(now);

		// Always invalidate the cached token so a retry mints a new one.
		this.#clearToken(name);

		if (times.length >= this.#maxRejections) {
			this.#rejectionTimes.delete(name);
			this.#emitTokenRejection({ name, rejections: times.length });
			return false;
		}

		this.#rejectionTimes.set(name, times);
		return true;
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

	public backendTokenExists(checkExpiration: boolean = true): boolean {
		return this.tokenExists('backend', checkExpiration);
	}

	public anonymousTokenExists(checkExpiration: boolean = true): boolean {
		return this.tokenExists('anonymous', checkExpiration);
	}

	public tokenExists(name: keyof typeof AuthTokens.MANIFEST, checkExpiration: boolean = true): boolean {
		const existing = this.#tokens.get(name);
		if (existing && (!checkExpiration || !existing.isExpired())) return true;

		const jwt = localStorage.getItem(`authToken:${name}`);
		if (!jwt) return false;

		if (!checkExpiration) return true;

		try {
			const token = new AccessToken(jwt);
			this.#tokens.set(name, token);
			return !token.isExpired();
		} catch {
			return false;
		}
	}

	public forceRefreshBackendToken(): Promise<AccessTokenInterface> {
		return this.forceRefreshToken('backend');
	}

	public forceRefreshAnonymousToken(): Promise<AccessTokenInterface> {
		return this.forceRefreshToken('anonymous');
	}

	public async forceRefreshToken(name: keyof typeof AuthTokens.MANIFEST): Promise<AccessTokenInterface> {
		this.#clearToken(name);
		return this.ensureToken(name);
	}

	async clear(): Promise<void> {
		for (const name of this.#tokens.keys()) {
			this.#clearToken(name);
		}
		this.#rejectionTimes.clear();
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

	#clearToken(tokenId: string): void {
		localStorage.removeItem(`authToken:${tokenId}`);
		this.#tokens.delete(tokenId);
	}

	#emitTokenRejection(info: TokenRejectionInfo<keyof AuthTokensManifest>): void {
		for (const listener of this.#rejectionListeners) {
			try {
				listener(info);
			} catch (e) {
				logger.error('Error in token rejection listener:', e);
			}
		}
	}
}
