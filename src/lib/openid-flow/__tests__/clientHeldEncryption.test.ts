/**
 * Client-held response encryption (engine-blind encryption): unit tests.
 */

import { describe, it, expect } from 'vitest';
import { CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK } from 'jose';
import type { JWK } from 'jose';
import {
	assertEngineAcceptableJwe,
	ClientHeldEncryptionError,
	ClientHeldEncryptionKeys,
	RESPONSE_ENCS,
	RESPONSE_KEY_ALGS,
	buildJarmResponse,
} from '../transports/clientHeldEncryption';

/** What an issuer does: encrypt a Credential Response to the wallet's public JWK. */
async function issuerEncrypt(jwk: JWK, alg: string, enc: string, body: unknown): Promise<string> {
	const key = await importJWK(jwk, alg);
	return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(body)))
		.setProtectedHeader({ alg, enc })
		.encrypt(key);
}

const ISSUED = 'eyJhbGciOiJFUzI1NiJ9.issued.credential~disclosure~';

describe('ClientHeldEncryptionKeys.generate', () => {
	it('returns only the public half, with use=enc and the negotiated alg', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' });

		expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'enc', alg: 'ECDH-ES+A256KW' });
		expect(typeof jwk?.x).toBe('string');
		expect(typeof jwk?.y).toBe('string');
		expect(jwk).not.toHaveProperty('d');
		expect(keys.has('flow-1')).toBe(true);
	});

	it('makes a fresh key for every request of a flow and drops the previous one', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const second = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });

		expect(second?.x).not.toEqual(first?.x);

		// An answer encrypted to the first key no longer decrypts.
		const stale = await issuerEncrypt(first!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED] });
		await expect(keys.decrypt('flow-1', stale)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		const current = await issuerEncrypt(second!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED] });
		await expect(keys.decrypt('flow-1', current)).resolves.toEqual({ credentialCount: 1 });
	});

	it('declines an unsupported request that is not required, and stores no key', async () => {
		const keys = new ClientHeldEncryptionKeys();
		await expect(keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM' })).resolves.toBeUndefined();
		await expect(keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A192GCM' })).resolves.toBeUndefined();
		expect(keys.has('flow-1')).toBe(false);
	});

	it('fails closed when the issuer requires encryption the wallet cannot do', async () => {
		const keys = new ClientHeldEncryptionKeys();
		await expect(
			keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM', required: true }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		expect(keys.has('flow-1')).toBe(false);
	});
});

describe('ClientHeldEncryptionKeys.decrypt', () => {
	const combos = RESPONSE_KEY_ALGS.flatMap((alg) => RESPONSE_ENCS.map((enc) => [alg, enc] as const));

	it.each(combos)('decrypts %s with %s', async (alg, enc) => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg, enc });
		const jwe = await issuerEncrypt(jwk!, alg, enc, { credentials: [{ credential: ISSUED }] });

		await keys.decrypt('flow-1', jwe);

		expect(keys.response('flow-1')?.credentials).toEqual([ISSUED]);
	});

	it('tells the engine only how many credentials were issued, never their contents', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', {
			credentials: [ISSUED, 'second'],
			notification_id: 'n-1',
			credential_metadata: { 'org.siros.secret_seed': { ns: 'ab'.repeat(16) } },
		});

		const control = await keys.decrypt('flow-1', jwe);

		expect(control).toEqual({ credentialCount: 2 });
		expect(JSON.stringify(control)).not.toContain(ISSUED);
		expect(JSON.stringify(control)).not.toContain('ab'.repeat(16));
		expect(JSON.stringify(control)).not.toContain('n-1');
	});

	it('tells the engine only the transaction to poll for a deferred answer', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });

		const control = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { transaction_id: 'tx-1', interval: 5 }),
		);

		expect(control).toEqual({ transactionId: 'tx-1', interval: 5 });
	});

	it('refuses an answer that is both credentials and a transaction, or neither', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });

		for (const body of [{ transaction_id: 'tx-1', credentials: [ISSUED] }, {}, { credentials: [] }]) {
			await expect(
				keys.decrypt('flow-1', await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', body)),
			).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		}
	});

	it('accepts 256 credentials and refuses 257', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const many = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { credentials: many(256) })),
		).resolves.toEqual({ credentialCount: 256 });
		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { credentials: many(257) })),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('requires the issuer JWE to use exactly the negotiated alg and enc', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES+A256KW', enc: 'A256GCM' });

		// A pair the wallet supports in general, but not the one it negotiated.
		for (const [alg, enc] of [
			['ECDH-ES', 'A256GCM'],
			['ECDH-ES+A128KW', 'A256GCM'],
			['ECDH-ES+A256KW', 'A128GCM'],
		] as const) {
			await expect(
				keys.decrypt('flow-1', await issuerEncrypt({ ...jwk!, alg }, alg, enc, { credentials: [ISSUED] })),
			).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		}
		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk!, 'ECDH-ES+A256KW', 'A256GCM', { credentials: [ISSUED] })),
		).resolves.toEqual({ credentialCount: 1 });
	});

	it('keeps credentials, response-level metadata and notification_id locally', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const metadata = { 'org.siros.secret_seed': { ns: 'ab'.repeat(16) }, display: [{ name: 'x' }] };
		const jwe = await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', {
			credential: 'single',
			credentials: [{ credential: 'wrapped' }, 'plain', { other: 1 }],
			notification_id: 'n-1',
			credential_metadata: metadata,
		});

		await keys.decrypt('flow-1', jwe);

		expect(keys.response('flow-1')).toEqual({
			credentials: ['single', 'wrapped', 'plain', '{"other":1}'],
			credentialMetadata: metadata,
			notificationId: 'n-1',
		});
	});

	it('lets a deferred answer supply the credentials an empty first answer lacked', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });

		const pending = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { transaction_id: 'tx-1', interval: 2 }),
		);
		expect(pending).toEqual({ transactionId: 'tx-1', interval: 2 });
		expect(keys.response('flow-1')?.credentials).toEqual([]);

		const again = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { transaction_id: 'tx-1', interval: 5 }),
		);
		expect(again).toEqual({ transactionId: 'tx-1', interval: 5 });

		const done = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED], notification_id: 'n-2' }),
		);
		expect(done).toEqual({ credentialCount: 1 });
		expect(keys.response('flow-1')).toMatchObject({ credentials: [ISSUED], notificationId: 'n-2' });
	});

	it('refuses with a message that carries no contents when it cannot decrypt', async () => {
		const keys = new ClientHeldEncryptionKeys();
		await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const other = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const wrongKey = await issuerEncrypt(
			{ ...(await exportJWK(other.publicKey)), alg: 'ECDH-ES' },
			'ECDH-ES',
			'A256GCM',
			{ credentials: [ISSUED] },
		);

		for (const jwe of [wrongKey, 'not.a.jwe', '']) {
			const error = await keys.decrypt('flow-1', jwe).catch((e) => e);
			expect(error).toBeInstanceOf(ClientHeldEncryptionError);
			expect(error.message).not.toContain(ISSUED);
			expect(error.message).not.toContain(jwe === '' ? 'never-matches' : jwe);
		}
	});

	it('refuses a decrypted body that is not a JSON object', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', [ISSUED]);

		await expect(keys.decrypt('flow-1', jwe)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('refuses a content encryption outside the supported set', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(jwk!, 'ECDH-ES', 'A192GCM', { credentials: [ISSUED] });

		await expect(keys.decrypt('flow-1', jwe)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('drops the previous key and decrypted response when a replacement request cannot be served', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(first!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED] });
		await keys.decrypt('flow-1', jwe);
		expect(keys.response('flow-1')?.credentials).toEqual([ISSUED]);

		// Not required: declined, but the old key must be gone all the same.
		await expect(keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM' })).resolves.toBeUndefined();

		expect(keys.has('flow-1')).toBe(false);
		expect(keys.response('flow-1')).toBeUndefined();
		await expect(keys.decrypt('flow-1', jwe)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('also drops the previous key when a required replacement fails', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(first!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED] });

		await expect(
			keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM', required: true }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);

		expect(keys.has('flow-1')).toBe(false);
		await expect(keys.decrypt('flow-1', jwe)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it.each([
		['drop()', (keys: ClientHeldEncryptionKeys) => keys.drop('flow-1')],
		['clear()', (keys: ClientHeldEncryptionKeys) => keys.clear()],
	])('stores and returns no key when the flow ends through %s while it is being generated', async (_name, end) => {
		const keys = new ClientHeldEncryptionKeys();

		const pending = keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		end(keys);

		await expect(pending).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		expect(keys.has('flow-1')).toBe(false);
	});

	it('lets only the newest of two overlapping requests for a flow store its key', async () => {
		const keys = new ClientHeldEncryptionKeys();

		const older = keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const newer = keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const [olderResult, newerResult] = await Promise.allSettled([older, newer]);

		expect(olderResult.status).toBe('rejected');
		expect(newerResult.status).toBe('fulfilled');
		const jwe = await issuerEncrypt(
			(newerResult as PromiseFulfilledResult<JWK>).value,
			'ECDH-ES',
			'A256GCM',
			{ credentials: [ISSUED] },
		);
		await expect(keys.decrypt('flow-1', jwe)).resolves.toEqual({ credentialCount: 1 });
	});

	it('has no key after drop() or clear()', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const jwk = await keys.generate('flow-1', { alg: 'ECDH-ES', enc: 'A256GCM' });
		await keys.generate('flow-2', { alg: 'ECDH-ES', enc: 'A256GCM' });
		const jwe = await issuerEncrypt(jwk!, 'ECDH-ES', 'A256GCM', { credentials: [ISSUED] });

		keys.drop('flow-1');
		await expect(keys.decrypt('flow-1', jwe)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		expect(keys.has('flow-2')).toBe(true);

		keys.clear();
		expect(keys.has('flow-2')).toBe(false);
	});
});

describe('buildJarmResponse', () => {
	async function verifier(alg = 'ECDH-ES') {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(publicKey)), kid: 'v-1', use: 'enc', alg };
		return { jwk, privateKey };
	}

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
		expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES', enc: 'A128GCM', kid: 'v-1', cty: 'JWT' });
		expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual({
			iss: 'https://self-issued.me/v2',
			aud: 'x509_san_dns:verifier.example.com',
			iat: 1_700_000_000,
			exp: 1_700_000_300,
			vp_token: { pid: ['sd-jwt~kb'] },
			state: 'st-1',
		});
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
});

describe('buildJarmResponse: what the engine will accept', () => {
	async function verifier(alg: string) {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		return { jwk: { ...(await exportJWK(publicKey)), kid: 'v-1', alg }, privateKey };
	}

	it('accepts a non-ASCII kid: the header is read as UTF-8, not as a binary string', async () => {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(publicKey)), kid: 'clé-1 ✓', alg: 'ECDH-ES' };

		const jwe = await buildJarmResponse({
			vpToken: '{}',
			audience: 'v',
			encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
		});

		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader.kid).toBe('clé-1 ✓');
	});

	it('refuses a private verifier key', async () => {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(privateKey)), kid: 'v-1' };
		void publicKey;

		await expect(
			buildJarmResponse({ vpToken: '{}', audience: 'v', encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' } }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('has an empty encrypted-key segment only for direct ECDH-ES', async () => {
		const direct = await verifier('ECDH-ES');
		const wrapped = await verifier('ECDH-ES+A256KW');

		const a = await buildJarmResponse({
			vpToken: '{}', audience: 'v', encryption: { jwk: direct.jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
		});
		const b = await buildJarmResponse({
			vpToken: '{}', audience: 'v', encryption: { jwk: wrapped.jwk, alg: 'ECDH-ES+A256KW', enc: 'A128GCM' },
		});

		expect(a.split('.')[1]).toBe('');
		expect(b.split('.')[1]).not.toBe('');
		expect(b.split('.').every((seg) => seg.length > 0)).toBe(true);
	});

	it('refuses a response above 4 MiB', async () => {
		const { jwk } = await verifier('ECDH-ES');

		await expect(
			buildJarmResponse({
				vpToken: 'x'.repeat(4 * 1024 * 1024),
				audience: 'v',
				encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
			}),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});
});

describe('assertEngineAcceptableJwe', () => {
	const b64 = (o: unknown) =>
		btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	const jwe = (header: unknown, segments = ['ek', 'iv', 'ct', 'tag']) => [b64(header), ...segments].join('.');
	const expected = { alg: 'ECDH-ES+A256KW', enc: 'A128GCM', kid: 'k1' };
	const header = { alg: 'ECDH-ES+A256KW', enc: 'A128GCM', kid: 'k1' };

	it('accepts a well-formed response', () => {
		expect(() => assertEngineAcceptableJwe(jwe(header), expected)).not.toThrow();
	});

	it.each([
		['alg differs', { ...header, alg: 'ECDH-ES' }],
		['enc differs', { ...header, enc: 'A256GCM' }],
		['kid differs', { ...header, kid: 'other' }],
		['kid missing though the key has one', { alg: header.alg, enc: header.enc }],
	])('refuses a header whose %s', (_label, h) => {
		expect(() => assertEngineAcceptableJwe(jwe(h), expected)).toThrow(ClientHeldEncryptionError);
	});

	it('compares a UTF-8 kid as text', () => {
		const kid = 'clé-1';
		expect(() =>
			assertEngineAcceptableJwe(jwe({ ...header, kid }), { ...expected, kid }),
		).not.toThrow();
		expect(() =>
			assertEngineAcceptableJwe(jwe({ ...header, kid: 'clÃ©-1' }), { ...expected, kid }),
		).toThrow(ClientHeldEncryptionError);
	});

	it('does not require a kid when the key has none', () => {
		expect(() =>
			assertEngineAcceptableJwe(jwe({ alg: 'ECDH-ES+A256KW', enc: 'A128GCM' }), { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' }),
		).not.toThrow();
	});

	it('refuses the wrong number of segments, an empty segment, and non-base64url text', () => {
		expect(() => assertEngineAcceptableJwe(jwe(header, ['ek', 'iv', 'ct']), expected)).toThrow(ClientHeldEncryptionError);
		expect(() => assertEngineAcceptableJwe(jwe(header, ['ek', '', 'ct', 'tag']), expected)).toThrow(ClientHeldEncryptionError);
		expect(() => assertEngineAcceptableJwe(jwe(header, ['ek', 'iv', 'ct', 'ta g']), expected)).toThrow(ClientHeldEncryptionError);
		expect(() => assertEngineAcceptableJwe('', expected)).toThrow(ClientHeldEncryptionError);
	});

	it('allows an empty encrypted key only for direct ECDH-ES', () => {
		const direct = { alg: 'ECDH-ES', enc: 'A128GCM', kid: 'k1' };
		expect(() =>
			assertEngineAcceptableJwe(jwe(direct, ['', 'iv', 'ct', 'tag']), { alg: 'ECDH-ES', enc: 'A128GCM', kid: 'k1' }),
		).not.toThrow();
		expect(() => assertEngineAcceptableJwe(jwe(header, ['', 'iv', 'ct', 'tag']), expected)).toThrow(
			ClientHeldEncryptionError,
		);
	});
});
