import { describe, it, expect, afterEach, vi } from 'vitest';
import { AccessToken } from './AccessToken';
import { AuthError } from '../resources';

type JwtPayload = Record<string, unknown>;

const base64UrlEncode = (obj: object): string =>
	btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const defaultHeader = { alg: 'ES256', kid: 'test-key-id', typ: 'JWT' };

const defaultPayload = (): JwtPayload => ({
	sub: 'test-subject',
	aud: 'wallet-backend',
	tenant_id: 'default',
	tac: 'rwlid',
	acr: 'urn:siros:acr:passkey',
	exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour from now
});

const makeJwt = (payloadOverrides: JwtPayload = {}, header: object = defaultHeader): string => {
	const payload = { ...defaultPayload(), ...payloadOverrides };
	return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.test-signature`;
};

describe('AccessToken', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('parsing', () => {
		it('parses all claims from a valid token', () => {
			const exp = Math.floor(Date.now() / 1000) + 120;
			const raw = makeJwt({
				sub: 'user-123',
				aud: 'wallet-backend',
				tenant_id: 'acme',
				tac: 'rl',
				acr: 'urn:siros:acr:oidc',
				exp,
			});

			const token = new AccessToken(raw);

			expect(token.raw).toBe(raw);
			expect(token.sub).toBe('user-123');
			expect(token.aud).toBe('wallet-backend');
			expect(token.tenantId).toBe('acme');
			expect(token.acr).toBe('urn:siros:acr:oidc');
			expect(token.expiresAt).toEqual(new Date(exp * 1000));
		});

		it('parses tac into a Set of permission flags', () => {
			const token = new AccessToken(makeJwt({ tac: 'rwlid' }));

			expect(token.tac).toBeInstanceOf(Set);
			expect(token.tac.size).toBe(5);
			expect([...token.tac].sort()).toEqual(['d', 'i', 'l', 'r', 'w']);
			expect(token.tac.has('r')).toBe(true);
			expect(token.tac.has('a')).toBe(false);
		});

		it('parses a single-permission tac', () => {
			const token = new AccessToken(makeJwt({ tac: 'r' }));

			expect(token.tac.size).toBe(1);
			expect(token.tac.has('r')).toBe(true);
		});

		it('parses an anonymous token that has no sub', () => {
			const token = new AccessToken(makeJwt({ sub: undefined }));

			expect(token.sub).toBeUndefined();
			expect(token.aud).toBe('wallet-backend');
			expect(token.tenantId).toBe('default');
		});

		it('parses a token without an acr claim', () => {
			const token = new AccessToken(makeJwt({ acr: undefined }));

			expect(token.acr).toBeUndefined();
		});
	});

	describe('invalid tokens', () => {
		it('rejects a random string that is not a JWT', () => {
			expect(() => new AccessToken('not-a-jwt')).toThrow(AuthError);
		});

		it('throws AuthError when the aud claim is missing', () => {
			expect(() => new AccessToken(makeJwt({ aud: undefined }))).toThrow(AuthError);
		});

		it('throws AuthError when the tenant_id claim is missing', () => {
			expect(() => new AccessToken(makeJwt({ tenant_id: undefined }))).toThrow(AuthError);
		});

		it('throws AuthError when the exp claim is missing', () => {
			expect(() => new AccessToken(makeJwt({ exp: undefined }))).toThrow(AuthError);
		});

		it('throws AuthError for an unknown acr value', () => {
			expect(() => new AccessToken(makeJwt({ acr: 'urn:siros:acr:unknown' }))).toThrow(AuthError);
		});

		it('throws AuthError with the expected message', () => {
			expect(() => new AccessToken(makeJwt({ aud: undefined }))).toThrow(
				'Failed to parse access token',
			);
		});
	});

	describe('isExpired', () => {
		it('returns false for a token that expires well in the future', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const exp = Math.floor(Date.now() / 1000) + 60;

			const token = new AccessToken(makeJwt({ exp }));

			expect(token.isExpired()).toBe(false);
		});

		it('returns true for a token that has already expired', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const exp = Math.floor(Date.now() / 1000) - 60;

			const token = new AccessToken(makeJwt({ exp }));

			expect(token.isExpired()).toBe(true);
		});

		it('treats a token within the 10s clock-skew window as expired', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			// Expires 5s from now — inside the 10s safety margin.
			const exp = Math.floor(Date.now() / 1000) + 5;

			const token = new AccessToken(makeJwt({ exp }));

			expect(token.isExpired()).toBe(true);
		});
	});

	describe('token()', () => {
		it('returns the raw JWT string', () => {
			const raw = makeJwt();
			const token = new AccessToken(raw);

			expect(token.token()).toBe(raw);
			expect(token.token()).toBe(token.raw);
		});
	});
});
