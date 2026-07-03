/**
 * Token Access Control permission flags.
 *
 * |Flag|Purpose |
 * |----|------- |
 * |`r` |read    |
 * |`w` |write   |
 * |`l` |list    |
 * |`i` |insert  |
 * |`d` |delete  |
 * |`k` |delegate|
 * |`a` |admin   |
 */
export type TacPermission = 'r' | 'w' | 'l' | 'i' | 'd' | 'k' | 'a';

/**
 * Store as a set-like list on client side for easy checks.
 * (Backend may encode as bitfield/string; parse into this.)
 */
export type Tac = ReadonlySet<TacPermission>;

/**
 * Authentication Context Class Reference.
 * Keep known values explicit, allow forward-compatible custom values.
 */
export type Acr = `urn:siros:acr:${| 'passkey' | 'oidc'}`;

/**
 * Parsed access token with claims and utility methods.
 */
export interface AccessTokenInterface {
	/**
	 * Raw JWT string.
	 */
	readonly raw: string;

	/**
	 * Subject - user ID this token represents.
	 */
	readonly sub: string;
	/**
	 * Audience - service this token is valid for.
	 */
	readonly aud: string;
	/**
	 * Tenant ID for multi-tenant isolation.
	 */
	readonly tenantId: string;
	/**
	 * Token Access Control permissions.
	 */
	readonly tac: Tac;
	/**
	 * Authentication context - how user authenticated.
	 */
	readonly acr: Acr;
	/**
	 * Token expiration timestamp.
	 */
	readonly expiresAt: Date;

	/**
	 * True if token is expired.
	 */
	isExpired(): boolean;
	/**
	 * Returns raw JWT for Authorization header.
	 */
	token(): string;
}

export interface TokenRejectionInfo<M extends string> {
	name: M;
	rejections: number;
}

export type TokenRejectionListener<M extends string> = (info: TokenRejectionInfo<M>) => void;
