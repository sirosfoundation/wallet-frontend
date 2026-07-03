import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { AuthServerClient } from './AuthServerClient';

vi.mock('axios', () => ({
	default: {
		post: vi.fn(),
		delete: vi.fn(),
	},
}));

const post = vi.mocked(axios.post);
const del = vi.mocked(axios.delete);

const BASE_URL = 'https://backend.example.com';

const okData = <T,>(data: T) => ({ data }) as never;

const loginBeginData = { challengeId: 'chal-1', getOptions: { publicKey: {} } };
const loginFinishData = {
	uuid: 'u-1',
	displayName: 'Alice',
	tenantId: 'default',
	tenantDisplayName: 'Default',
};
const registerBeginData = {
	challengeId: 'chal-2',
	createOptions: { publicKey: {} },
};
const registerFinishData = {
	uuid: 'u-2',
	displayName: 'Bob',
	tenantId: 'acme',
	tenantDisplayName: 'Acme',
};
const tokenData = {
	access_token: 'jwt-token',
	token_type: 'Bearer' as const,
	expires_in: 120,
};

const fakeAssertionCredential = () =>
	({
		type: 'public-key',
		id: 'cred-id',
		rawId: new Uint8Array([1]).buffer,
		response: {
			authenticatorData: new Uint8Array([2]).buffer,
			clientDataJSON: new Uint8Array([3]).buffer,
			signature: new Uint8Array([4]).buffer,
			userHandle: new Uint8Array([5]).buffer,
		},
		authenticatorAttachment: 'platform',
		getClientExtensionResults: () => ({}),
	}) as unknown as PublicKeyCredential;

const fakeAttestationCredential = () =>
	({
		type: 'public-key',
		id: 'cred-id',
		rawId: new Uint8Array([1]).buffer,
		response: {
			attestationObject: new Uint8Array([2]).buffer,
			clientDataJSON: new Uint8Array([3]).buffer,
		},
		authenticatorAttachment: 'platform',
		getClientExtensionResults: () => ({}),
	}) as unknown as PublicKeyCredential;

describe('AuthServerClient', () => {
	let client: AuthServerClient;

	beforeEach(() => {
		post.mockReset();
		del.mockReset();
		client = new AuthServerClient({ baseUrl: BASE_URL });
	});

	describe('requestAccessToken', () => {
		it('posts the token request with the expected body and header', async () => {
			post.mockResolvedValue(okData(tokenData));

			const res = await client.requestAccessToken(
				'wallet-backend',
				'default',
				'rl',
				true,
			);

			expect(post).toHaveBeenCalledTimes(1);
			const [url, body, cfg] = post.mock.calls[0];
			expect(url).toBe(`${BASE_URL}/auth/token`);
			expect(body).toEqual({
				aud: 'wallet-backend',
				tac: 'rl',
				tenant_id: 'default',
				anonymous: true,
			});
			expect(cfg?.headers).toMatchObject({ 'X-Token-Mode': 'session' });
			expect(res).toEqual(tokenData);
		});

		it('dedupes concurrent identical requests', async () => {
			post.mockResolvedValue(okData(tokenData));

			const [a, b] = await Promise.all([
				client.requestAccessToken('wallet-backend', 'default', 'rl', true),
				client.requestAccessToken('wallet-backend', 'default', 'rl', true),
			]);

			expect(post).toHaveBeenCalledTimes(1);
			expect(a).toEqual(b);
		});

		it('does not dedupe requests with different params', async () => {
			post.mockResolvedValue(okData(tokenData));

			await Promise.all([
				client.requestAccessToken('wallet-backend', 'default', 'rl', true),
				client.requestAccessToken('wallet-backend', 'default', 'rwlid'),
			]);

			expect(post).toHaveBeenCalledTimes(2);
		});

		it('issues a fresh request once the previous one settles', async () => {
			post.mockResolvedValue(okData(tokenData));

			await client.requestAccessToken('wallet-backend', 'default', 'rl', true);
			await client.requestAccessToken('wallet-backend', 'default', 'rl', true);

			expect(post).toHaveBeenCalledTimes(2);
		});

		it('throws on an invalid token response', async () => {
			post.mockResolvedValue(okData({ nope: true }));

			await expect(
				client.requestAccessToken('wallet-backend', 'default'),
			).rejects.toThrow('Invalid token endpoint response');
		});
	});

	describe('loginBegin', () => {
		it('sends session mode + tenant headers and returns parsed data', async () => {
			post.mockResolvedValue(okData(loginBeginData));

			const res = await client.loginBegin('acme');

			const [url, body, cfg] = post.mock.calls[0];
			expect(url).toBe(`${BASE_URL}/auth/passkey/login/begin`);
			expect(body).toEqual({});
			expect(cfg?.headers).toMatchObject({
				'X-Token-Mode': 'session',
				'X-Tenant-ID': 'acme',
			});
			expect(cfg?.headers).not.toHaveProperty('Authorization');
			expect(res).toEqual(loginBeginData);
		});

		it('attaches the OIDC id token as a bearer when provided', async () => {
			post.mockResolvedValue(okData(loginBeginData));

			await client.loginBegin('acme', 'oidc-id-token');

			const [, , cfg] = post.mock.calls[0];
			expect(cfg?.headers).toMatchObject({
				Authorization: 'Bearer oidc-id-token',
			});
		});

		it('throws on an invalid response', async () => {
			post.mockResolvedValue(okData({ challengeId: 123 }));

			await expect(client.loginBegin('acme')).rejects.toThrow(
				'Invalid login begin response',
			);
		});
	});

	describe('loginFinish', () => {
		it('posts the challenge and credential and returns parsed data', async () => {
			post.mockResolvedValue(okData(loginFinishData));

			const res = await client.loginFinish(
				'chal-1',
				fakeAssertionCredential(),
				'default',
			);

			const [url, body] = post.mock.calls[0];
			expect(url).toBe(`${BASE_URL}/auth/passkey/login/finish`);
			expect(body).toMatchObject({ challengeId: 'chal-1' });
			expect(res).toEqual(loginFinishData);
		});
	});

	describe('registerBegin', () => {
		it('posts tenantId + inviteCode in the body', async () => {
			post.mockResolvedValue(okData(registerBeginData));

			await client.registerBegin('acme', 'invite-123');

			const [url, body, cfg] = post.mock.calls[0];
			expect(url).toBe(`${BASE_URL}/auth/passkey/register/begin`);
			expect(body).toEqual({ tenantId: 'acme', inviteCode: 'invite-123' });
			expect(cfg?.headers).toMatchObject({ 'X-Tenant-ID': 'acme' });
		});
	});

	describe('registerFinish', () => {
		it('posts displayName, privateData and credential', async () => {
			post.mockResolvedValue(okData(registerFinishData));

			const res = await client.registerFinish(
				'chal-2',
				fakeAttestationCredential(),
				'Bob',
				{ some: 'privateData' },
				'acme',
			);

			const [url, body] = post.mock.calls[0];
			expect(url).toBe(`${BASE_URL}/auth/passkey/register/finish`);
			expect(body).toMatchObject({
				challengeId: 'chal-2',
				displayName: 'Bob',
				privateData: { some: 'privateData' },
			});
			expect(res).toEqual(registerFinishData);
		});
	});

	describe('logout', () => {
		it('deletes the session with credentials', async () => {
			del.mockResolvedValue(okData({}));

			await client.logout();

			expect(del).toHaveBeenCalledWith(
				`${BASE_URL}/auth/session`,
				expect.objectContaining({ withCredentials: true }),
			);
		});
	});
});
