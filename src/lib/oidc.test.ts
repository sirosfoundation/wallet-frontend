/**
 * Tests for OIDC PKCE flow utilities (src/lib/oidc.ts)
 *
 * Covers issue #38: unit tests for the OIDC gate utility functions.
 *
 * Sections tested:
 *   - Storage utilities (storeIdToken, getStoredIdToken, clearStoredIdToken, clearOIDCState)
 *   - Token parsing (extractIdTokenClaims, getDisplayNameFromToken)
 *   - Configuration builder (buildOIDCConfig)
 *   - Flow mode detection (getOIDCFlowMode)
 *   - handleOIDCCallback error paths
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
		storeIdToken,
		getStoredIdToken,
		clearStoredIdToken,
		clearOIDCState,
		extractIdTokenClaims,
		getDisplayNameFromToken,
		buildOIDCConfig,
		getOIDCFlowMode,
		handleOIDCCallback,
		validateIdToken,
} from './oidc';
import type { OIDCFlowConfig } from './oidc';
import type { OIDCProviderConfig } from '../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal JWT with the given payload (no signature validation). */
function makeJwt(payload: Record<string, unknown>): string {
		const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
		const body = btoa(JSON.stringify(payload))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
		return `${header}.${body}.fakesig`;
}

// ---------------------------------------------------------------------------
// 1. Storage utilities
// ---------------------------------------------------------------------------

describe('storeIdToken / getStoredIdToken / clearStoredIdToken', () => {
		beforeEach(() => sessionStorage.clear());

		it('stores and retrieves a token for registration purpose', () => {
				storeIdToken('registration', 'tok-reg');
				expect(getStoredIdToken('registration')).toBe('tok-reg');
		});

		it('stores and retrieves a token for login purpose', () => {
				storeIdToken('login', 'tok-login');
				expect(getStoredIdToken('login')).toBe('tok-login');
		});

		it('registration and login tokens are stored independently', () => {
				storeIdToken('registration', 'tok-reg');
				storeIdToken('login', 'tok-login');
				expect(getStoredIdToken('registration')).toBe('tok-reg');
				expect(getStoredIdToken('login')).toBe('tok-login');
		});

		it('returns null when no token is stored', () => {
				expect(getStoredIdToken('registration')).toBeNull();
				expect(getStoredIdToken('login')).toBeNull();
		});

		it('clearStoredIdToken removes only the specified purpose token', () => {
				storeIdToken('registration', 'tok-reg');
				storeIdToken('login', 'tok-login');
				clearStoredIdToken('registration');
				expect(getStoredIdToken('registration')).toBeNull();
				expect(getStoredIdToken('login')).toBe('tok-login');
		});
});

describe('clearOIDCState', () => {
		beforeEach(() => sessionStorage.clear());

		it('removes token, state, and verifier keys for the given purpose', () => {
				// Manually plant all three keys the way oidc.ts writes them
				sessionStorage.setItem('oidc_gate_registration_token', 'tok');
				sessionStorage.setItem('oidc_gate_registration_state', '{"purpose":"registration"}');
				sessionStorage.setItem('oidc_gate_registration_verifier', 'verifier123');

				clearOIDCState('registration');

				expect(sessionStorage.getItem('oidc_gate_registration_token')).toBeNull();
				expect(sessionStorage.getItem('oidc_gate_registration_state')).toBeNull();
				expect(sessionStorage.getItem('oidc_gate_registration_verifier')).toBeNull();
		});

		it('does not affect the other purpose', () => {
				sessionStorage.setItem('oidc_gate_login_token', 'tok');
				sessionStorage.setItem('oidc_gate_registration_token', 'tok-reg');

				clearOIDCState('login');

				expect(sessionStorage.getItem('oidc_gate_login_token')).toBeNull();
				expect(sessionStorage.getItem('oidc_gate_registration_token')).toBe('tok-reg');
		});
});

// ---------------------------------------------------------------------------
// 2. Token parsing
// ---------------------------------------------------------------------------

describe('extractIdTokenClaims', () => {
		it('extracts claims from a valid JWT', () => {
				const jwt = makeJwt({ sub: 'user123', name: 'Alice', email: 'alice@example.com' });
				const claims = extractIdTokenClaims(jwt);
				expect(claims.sub).toBe('user123');
				expect(claims.name).toBe('Alice');
				expect(claims.email).toBe('alice@example.com');
		});

		it('returns empty object for a malformed token (no dots)', () => {
				expect(extractIdTokenClaims('notavalidtoken')).toEqual({});
		});

		it('returns empty object for a token with invalid base64 payload', () => {
				expect(extractIdTokenClaims('header.!!!.sig')).toEqual({});
		});

		it('returns empty object for an empty string', () => {
				expect(extractIdTokenClaims('')).toEqual({});
		});

		it('returns empty object for a token with only one segment', () => {
				expect(extractIdTokenClaims('onlyone')).toEqual({});
		});
});

describe('getDisplayNameFromToken', () => {
		it('prefers name claim', () => {
				const jwt = makeJwt({ sub: 's', email: 'e@example.com', name: 'Full Name' });
				expect(getDisplayNameFromToken(jwt)).toBe('Full Name');
		});

		it('falls back to email when name is absent', () => {
				const jwt = makeJwt({ sub: 's', email: 'e@example.com' });
				expect(getDisplayNameFromToken(jwt)).toBe('e@example.com');
		});

		it('falls back to sub when name and email are absent', () => {
				const jwt = makeJwt({ sub: 'user-id-123' });
				expect(getDisplayNameFromToken(jwt)).toBe('user-id-123');
		});

		it('returns null for a malformed token', () => {
				expect(getDisplayNameFromToken('garbage')).toBeNull();
		});
});

// ---------------------------------------------------------------------------
// 3. Configuration builder
// ---------------------------------------------------------------------------

describe('buildOIDCConfig', () => {
		const provider: OIDCProviderConfig = {
				issuer: 'https://idp.example.com',
				client_id: 'wallet-client',
				scopes: 'openid email',
		};

		it('maps provider fields to OIDCFlowConfig', () => {
				const cfg = buildOIDCConfig(provider, 'https://app.example.com/cb');
				expect(cfg.issuer).toBe('https://idp.example.com');
				expect(cfg.clientId).toBe('wallet-client');
				expect(cfg.scopes).toBe('openid email');
				expect(cfg.redirectUri).toBe('https://app.example.com/cb');
		});

		it('uses default scopes when provider.scopes is empty', () => {
				const cfg = buildOIDCConfig({ ...provider, scopes: '' }, 'https://app.example.com/cb');
				expect(cfg.scopes).toBe('openid profile email');
		});

		it('uses default scopes when provider.scopes is undefined', () => {
				const { scopes: _omit, ...noScopes } = provider;
				const cfg = buildOIDCConfig(noScopes as OIDCProviderConfig, 'https://app.example.com/cb');
				expect(cfg.scopes).toBe('openid profile email');
		});
});

// ---------------------------------------------------------------------------
// 4. Flow mode detection
// ---------------------------------------------------------------------------

describe('getOIDCFlowMode', () => {
		beforeEach(() => {
				// Reset to default (no native bridge)
				delete (window as Window & { NativeOIDCBridge?: unknown }).NativeOIDCBridge;
		});

		it('returns browser-redirect when no native bridge is present', () => {
				expect(getOIDCFlowMode()).toBe('browser-redirect');
		});

		it('returns browser-redirect when bridge is present but isAvailable() returns false', () => {
				(window as Window & { NativeOIDCBridge?: unknown }).NativeOIDCBridge = {
						isAvailable: () => false,
						startFlow: vi.fn(),
				};
				expect(getOIDCFlowMode()).toBe('browser-redirect');
		});

		it('returns native-bridge when bridge is present and isAvailable() returns true', () => {
				(window as Window & { NativeOIDCBridge?: unknown }).NativeOIDCBridge = {
						isAvailable: () => true,
						startFlow: vi.fn(),
				};
				expect(getOIDCFlowMode()).toBe('native-bridge');
		});
});

// ---------------------------------------------------------------------------
// 5. handleOIDCCallback error paths
// ---------------------------------------------------------------------------

describe('handleOIDCCallback error paths', () => {
		const config: OIDCFlowConfig = {
				issuer: 'https://idp.example.com',
				clientId: 'wallet-client',
				redirectUri: 'https://app.example.com/cb',
				scopes: 'openid email',
		};

		beforeEach(() => sessionStorage.clear());

		it('throws when the IdP returns an error parameter', async () => {
				// Simulate IdP error redirect
				Object.defineProperty(window, 'location', {
						value: new URL('https://app.example.com/cb?error=access_denied&error_description=User+denied+access'),
						writable: true,
						configurable: true,
				});
				await expect(handleOIDCCallback(config)).rejects.toThrow('User denied access');
		});

		it('throws when authorization code is missing', async () => {
				Object.defineProperty(window, 'location', {
						value: new URL('https://app.example.com/cb?state=somestate'),
						writable: true,
						configurable: true,
				});
				await expect(handleOIDCCallback(config)).rejects.toThrow('Missing authorization code or state');
		});

		it('throws when state is missing', async () => {
				Object.defineProperty(window, 'location', {
						value: new URL('https://app.example.com/cb?code=somecode'),
						writable: true,
						configurable: true,
				});
				await expect(handleOIDCCallback(config)).rejects.toThrow('Missing authorization code or state');
		});

		it('throws when state is not found in sessionStorage (invalid/expired)', async () => {
				Object.defineProperty(window, 'location', {
						value: new URL('https://app.example.com/cb?code=somecode&state=unknownstate'),
						writable: true,
						configurable: true,
				});
				// sessionStorage has no matching state key → purpose lookup fails
				await expect(handleOIDCCallback(config)).rejects.toThrow('Invalid or expired state');
		});

		it('throws when OIDC session data is missing despite valid state', async () => {
				Object.defineProperty(window, 'location', {
						value: new URL('https://app.example.com/cb?code=somecode&state=knownstate'),
						writable: true,
						configurable: true,
				});
				// Plant the state→purpose mapping but NOT the OIDCState/verifier keys
				sessionStorage.setItem('oidc_gate_state_knownstate', 'registration');
				await expect(handleOIDCCallback(config)).rejects.toThrow('Session expired, please try again');
		});
});

// ---------------------------------------------------------------------------
// 6. ID token validation (validateIdToken)
// ---------------------------------------------------------------------------

describe('validateIdToken', () => {
		const config: OIDCFlowConfig = {
				issuer: 'https://idp.example.com',
				clientId: 'wallet-client',
				redirectUri: 'https://app.example.com/cb',
				scopes: 'openid email',
		};
		const jwksUri = 'https://idp.example.com/.well-known/jwks.json';

		/** Generate an ES256 key pair and return signing key + JWK for JWKS mock. */
		async function createSigningFixture() {
				const { SignJWT, exportJWK, generateKeyPair } = await import('jose');
				const { privateKey, publicKey } = await generateKeyPair('ES256');
				const jwk = { ...(await exportJWK(publicKey)), kid: 'test-kid', alg: 'ES256', use: 'sig' };
				return { SignJWT, privateKey, jwk };
		}

		/** Create a signed ID token with the given claims merged onto defaults. */
		async function createToken(
				fixture: Awaited<ReturnType<typeof createSigningFixture>>,
				overrides: { nonce?: string; iss?: string; aud?: string | string[]; extra?: Record<string, unknown> } = {}
		) {
				const { SignJWT, privateKey } = fixture;
				const claims = { nonce: overrides.nonce ?? 'test-nonce', ...overrides.extra };
				return new SignJWT(claims)
						.setProtectedHeader({ alg: 'ES256', kid: 'test-kid' })
						.setIssuer(overrides.iss ?? 'https://idp.example.com')
						.setAudience(overrides.aud ?? 'wallet-client')
						.setExpirationTime('5m')
						.setIssuedAt()
						.sign(privateKey);
		}

		/** Mock fetch to return a JWKS response containing the given JWK. */
		function mockJwksFetch(jwk: Record<string, unknown>) {
				vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
						new Response(JSON.stringify({ keys: [jwk] }), {
								status: 200,
								headers: { 'Content-Type': 'application/json' },
						})
				);
		}

		beforeEach(() => {
				vi.restoreAllMocks();
		});

		it('throws when JWKS fetch fails', async () => {
				vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 500 }));
				await expect(
						validateIdToken('header.payload.sig', config, 'nonce123', jwksUri)
				).rejects.toThrow('Failed to fetch JWKS: 500');
		});

		it('throws when nonce does not match', async () => {
				const fixture = await createSigningFixture();
				const token = await createToken(fixture, { nonce: 'actual-nonce' });
				mockJwksFetch(fixture.jwk);
				await expect(validateIdToken(token, config, 'wrong-nonce', jwksUri)).rejects.toThrow('ID token nonce mismatch');
		});

		it('succeeds when signature, issuer, audience, and nonce are all valid', async () => {
				const fixture = await createSigningFixture();
				const token = await createToken(fixture, { nonce: 'correct-nonce' });
				mockJwksFetch(fixture.jwk);
				await expect(validateIdToken(token, config, 'correct-nonce', jwksUri)).resolves.toBeUndefined();
		});

		it('throws when token signature is invalid (wrong key)', async () => {
				const signingFixture = await createSigningFixture();
				const wrongFixture = await createSigningFixture(); // different key pair
				const token = await createToken(signingFixture);
				mockJwksFetch(wrongFixture.jwk); // publish wrong public key
				await expect(validateIdToken(token, config, 'test-nonce', jwksUri)).rejects.toThrow();
		});

		it('throws when audience does not match', async () => {
				const fixture = await createSigningFixture();
				const token = await createToken(fixture, { aud: 'wrong-client-id' });
				mockJwksFetch(fixture.jwk);
				await expect(validateIdToken(token, config, 'test-nonce', jwksUri)).rejects.toThrow();
		});

		it('throws when multi-audience token has wrong azp', async () => {
				const fixture = await createSigningFixture();
				const token = await createToken(fixture, {
						aud: ['wallet-client', 'other-client'],
						extra: { azp: 'other-client' },
				});
				mockJwksFetch(fixture.jwk);
				await expect(validateIdToken(token, config, 'test-nonce', jwksUri)).rejects.toThrow('ID token azp claim mismatch');
		});

		it('accepts multi-audience token when azp matches client_id', async () => {
				const fixture = await createSigningFixture();
				const token = await createToken(fixture, {
						aud: ['wallet-client', 'other-service'],
						extra: { azp: 'wallet-client' },
				});
				mockJwksFetch(fixture.jwk);
				await expect(validateIdToken(token, config, 'test-nonce', jwksUri)).resolves.toBeUndefined();
		});
});
