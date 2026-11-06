import { describe, it, expect } from 'vitest';
import { compactDecrypt, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import { ClientHeldEncryptionError } from '../errors';
import { buildJarmResponse, verifierJwkThumbprint } from './ResponseJwe';

async function verifier(alg = 'ECDH-ES', kid = 'v-1') {
	const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
	return { jwk: { ...(await exportJWK(publicKey)), kid, use: 'enc', alg }, privateKey };
}

describe('buildJarmResponse', () => {
	it('builds a compact JWE the verifier can decrypt, with the headers and claims it expects', async () => {
		const { jwk, privateKey } = await verifier();
		const vpToken = JSON.stringify({ pid: ['sd-jwt~kb'] });

		const jwe = await buildJarmResponse({
			vpToken,
			audience: 'x509_san_dns:verifier.example.com',
			state: 'st-1',
			encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
			now: () => 1_700_000_000_000,
		});

		expect(jwe.split('.')).toHaveLength(5);
		const { plaintext, protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).toEqual({ alg: 'ECDH-ES', enc: 'A128GCM', kid: 'v-1', epk: expect.any(Object) });
		expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual({
			iss: 'https://self-issued.me/v2',
			aud: 'x509_san_dns:verifier.example.com',
			iat: 1_700_000_000,
			exp: 1_700_000_300,
			vp_token: { pid: ['sd-jwt~kb'] },
			state: 'st-1',
		});
	});

	it('sets no cty: the plaintext is plain JSON claims, not a nested JWT (RFC 7519 5.2)', async () => {
		const { jwk, privateKey } = await verifier();

		const jwe = await buildJarmResponse({
			vpToken: '{}',
			audience: 'v',
			encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
		});

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).not.toHaveProperty('cty');
		expect(protectedHeader).not.toHaveProperty('typ');
	});

	it('uses a non-JSON vp_token as the string it is and omits an absent state', async () => {
		const { jwk, privateKey } = await verifier();

		const jwe = await buildJarmResponse({
			vpToken: 'plain.token~string',
			audience: 'verifier',
			encryption: { jwk, alg: 'ECDH-ES', enc: 'A256GCM' },
		});

		const { plaintext } = await compactDecrypt(jwe, privateKey);
		const claims = JSON.parse(new TextDecoder().decode(plaintext));
		expect(claims.vp_token).toBe('plain.token~string');
		expect(claims).not.toHaveProperty('state');
	});

	it('wraps the key for a key-wrap algorithm', async () => {
		const { jwk, privateKey } = await verifier('ECDH-ES+A256KW', 'wrapped-1');

		const jwe = await buildJarmResponse({
			vpToken: '{}',
			audience: 'v',
			encryption: { jwk, alg: 'ECDH-ES+A256KW', enc: 'A256GCM' },
		});

		expect(jwe.split('.')[1]).not.toBe('');
		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES+A256KW', enc: 'A256GCM', kid: 'wrapped-1' });
	});

	it('omits kid when the verifier key has none', async () => {
		const { jwk, privateKey } = await verifier();
		const { kid: _kid, ...withoutKid } = jwk;

		const jwe = await buildJarmResponse({
			vpToken: '{}',
			audience: 'verifier',
			encryption: { jwk: withoutKid, alg: 'ECDH-ES', enc: 'A128GCM' },
		});

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).not.toHaveProperty('kid');
	});

	it('keeps a non-ASCII kid intact in the header', async () => {
		const { jwk, privateKey } = await verifier('ECDH-ES', 'clé-1 ✓');

		const jwe = await buildJarmResponse({
			vpToken: '{}',
			audience: 'v',
			encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
		});

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader.kid).toBe('clé-1 ✓');
	});

	it('refuses without an audience, with an unusable key, or with an unsupported enc', async () => {
		const { jwk } = await verifier();
		const ok = { vpToken: '{}', audience: 'verifier', encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' } };

		await expect(buildJarmResponse({ ...ok, audience: '' })).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		await expect(
			buildJarmResponse({ ...ok, encryption: { jwk: { kty: 'EC' } as JWK, alg: 'ECDH-ES', enc: 'A128GCM' } }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		await expect(
			buildJarmResponse({ ...ok, encryption: { jwk, alg: 'ECDH-ES', enc: 'A192GCM' } }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('refuses a private verifier key', async () => {
		const { privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(privateKey)), kid: 'v-1' };

		await expect(
			buildJarmResponse({ vpToken: '{}', audience: 'v', encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' } }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});
});

describe('verifierJwkThumbprint', () => {
	it('is the RFC 7638 SHA-256 thumbprint (RFC 7638 section 3.1 vector)', async () => {
		const jwk: JWK = {
			kty: 'RSA',
			n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
			e: 'AQAB',
			alg: 'RS256',
			kid: '2011-04-29',
		};

		await expect(verifierJwkThumbprint(jwk)).resolves.toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
	});

	it('ignores the non-required members, so a kid, use or alg does not change it', async () => {
		const { jwk } = await verifier();
		const { kid: _kid, use: _use, alg: _alg, ...bare } = jwk;

		await expect(verifierJwkThumbprint(jwk)).resolves.toBe(await verifierJwkThumbprint(bare));
	});
});

describe('buildJarmResponse: every verifier key and algorithm the engine accepts (go-wallet-backend #471)', () => {
	async function decryptable(alg: string, options: { crv?: string; modulusLength?: number }, enc: string) {
		const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true, ...options });
		const jwk = { ...(await exportJWK(publicKey)), kid: `${alg}-key`, alg };
		const jwe = await buildJarmResponse({
			vpToken: '{"pid":["t"]}',
			audience: 'verifier',
			encryption: { jwk, alg, enc },
		});
		return { jwe, privateKey };
	}

	it.each([
		['ECDH-ES', { crv: 'P-256' }],
		['ECDH-ES', { crv: 'P-384' }],
		['ECDH-ES', { crv: 'P-521' }],
		['ECDH-ES+A128KW', { crv: 'P-384' }],
		['ECDH-ES+A256KW', { crv: 'P-521' }],
	])('encrypts for %s on %o', async (alg, options) => {
		const { jwe, privateKey } = await decryptable(alg, options, 'A128GCM');

		const { plaintext, protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).toMatchObject({ alg, enc: 'A128GCM', kid: `${alg}-key` });
		expect(JSON.parse(new TextDecoder().decode(plaintext)).vp_token).toEqual({ pid: ['t'] });
	});

	it.each(['RSA-OAEP', 'RSA-OAEP-256'])('encrypts for an RSA key with %s', async (alg) => {
		const { jwe, privateKey } = await decryptable(alg, { modulusLength: 2048 }, 'A256GCM');

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).toMatchObject({ alg, enc: 'A256GCM', kid: `${alg}-key` });
		expect(jwe.split('.')[1]).not.toBe('');
	});

	it.each(['A128GCM', 'A256GCM', 'A128CBC-HS256', 'A256CBC-HS512'])('encrypts with %s', async (enc) => {
		const { jwe, privateKey } = await decryptable('ECDH-ES', { crv: 'P-256' }, enc);

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader.enc).toBe(enc);
	});

	it.each([
		['EC P-384', () => generateKeyPair('ECDH-ES', { crv: 'P-384', extractable: true })],
		['RSA', () => generateKeyPair('RSA-OAEP-256', { modulusLength: 2048, extractable: true })],
	])('computes the thumbprint of an %s verifier key from its required members only', async (_name, make) => {
		const { publicKey } = await make();
		const jwk = await exportJWK(publicKey);

		const bare = await verifierJwkThumbprint(jwk);
		const decorated = await verifierJwkThumbprint({ ...jwk, kid: 'k', use: 'enc', alg: 'RSA-OAEP-256' });

		expect(decorated).toBe(bare);
		expect(bare).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});
