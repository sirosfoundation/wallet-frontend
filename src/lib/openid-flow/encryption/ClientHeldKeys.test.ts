import { describe, it, expect } from 'vitest';
import { CompactEncrypt, exportJWK, generateKeyPair, importJWK } from 'jose';
import type { JWK } from 'jose';
import { ClientHeldEncryptionError } from '../errors';
import { RESPONSE_ENCS, RESPONSE_KEY_ALGS } from './algorithms';
import { ClientHeldEncryptionKeys } from './ClientHeldKeys';

/** What an issuer does: encrypt a Credential Response to the wallet's public JWK. */
async function issuerEncrypt(jwk: JWK, alg: string, enc: string, body: unknown): Promise<string> {
	const key = await importJWK(jwk, alg);
	return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(body)))
		.setProtectedHeader({ alg, enc })
		.encrypt(key);
}

const ISSUED = 'eyJhbGciOiJFUzI1NiJ9.issued.credential~disclosure~';
const SEED = 'ab'.repeat(16);
const seedMetadata = { 'org.siros.secret_seed': { ns: SEED } };
const immediate = { deferred: false };
const deferred = { deferred: true };

/** Generate a key for a flow with the default pair and return it. */
async function keyFor(keys: ClientHeldEncryptionKeys, flowId = 'flow-1', alg = 'ECDH-ES', enc = 'A256GCM') {
	const generated = await keys.generate(flowId, { alg, enc });
	return { jwk: generated!.jwk, generation: generated!.generation };
}

describe('ClientHeldEncryptionKeys.generate', () => {
	it('returns only the public half, with use=enc and the negotiated alg', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const generated = await keys.generate('flow-1', { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' });

		expect(generated?.jwk).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'enc', alg: 'ECDH-ES+A256KW' });
		expect(generated?.jwk).not.toHaveProperty('d');
		expect(Object.keys(generated!.jwk).sort()).toEqual(['alg', 'crv', 'kty', 'use', 'x', 'y']);
		expect(keys.has('flow-1')).toBe(true);
	});

	it('makes a fresh key for every request of a flow and drops the previous one', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keyFor(keys);
		const second = await keyFor(keys);

		expect(second.jwk.x).not.toEqual(first.jwk.x);
		const stale = await issuerEncrypt(first.jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });
		await expect(keys.decrypt('flow-1', stale, immediate)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		const current = await issuerEncrypt(second.jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });
		await expect(keys.decrypt('flow-1', current, immediate)).resolves.toEqual({ credentialCount: 1 });
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

	it('drops the previous key and decrypted response when a replacement request cannot be served', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keyFor(keys);
		const jwe = await issuerEncrypt(first.jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });
		await keys.decrypt('flow-1', jwe, immediate);
		expect(keys.response('flow-1')?.credentials).toEqual([ISSUED]);

		await expect(keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM' })).resolves.toBeUndefined();

		expect(keys.has('flow-1')).toBe(false);
		expect(keys.response('flow-1')).toBeUndefined();
		await expect(keys.decrypt('flow-1', jwe, immediate)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('also drops the previous key when a required replacement fails', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const first = await keyFor(keys);
		const jwe = await issuerEncrypt(first.jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });

		await expect(
			keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM', required: true }),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);

		expect(keys.has('flow-1')).toBe(false);
		await expect(keys.decrypt('flow-1', jwe, immediate)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
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
			(newerResult as PromiseFulfilledResult<{ jwk: JWK }>).value.jwk,
			'ECDH-ES',
			'A256GCM',
			{ credentials: [{ credential: ISSUED }] },
		);
		await expect(keys.decrypt('flow-1', jwe, immediate)).resolves.toEqual({ credentialCount: 1 });
	});
});

describe('ClientHeldEncryptionKeys.owns', () => {
	it('is true for the generation that holds the flow’s key', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { generation } = await keyFor(keys);

		expect(keys.owns('flow-1', generation)).toBe(true);
	});

	it('is false for an older generation once a newer request replaced the key', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const older = await keyFor(keys);
		const newer = await keyFor(keys);

		expect(keys.owns('flow-1', older.generation)).toBe(false);
		expect(keys.owns('flow-1', newer.generation)).toBe(true);
	});

	it.each([
		['dropped', (keys: ClientHeldEncryptionKeys) => keys.drop('flow-1')],
		['cleared', (keys: ClientHeldEncryptionKeys) => keys.clear()],
	])('is false once the flow was %s', async (_name, end) => {
		const keys = new ClientHeldEncryptionKeys();
		const { generation } = await keyFor(keys);

		end(keys);

		expect(keys.owns('flow-1', generation)).toBe(false);
	});

	it('is false for a generation whose key was never stored, and for another flow', async () => {
		const keys = new ClientHeldEncryptionKeys();
		await keys.generate('flow-1', { alg: 'RSA-OAEP', enc: 'A256GCM' });
		const { generation } = await keyFor(keys, 'flow-2');

		expect(keys.has('flow-1')).toBe(false);
		expect(keys.owns('flow-1', generation)).toBe(false);
		expect(keys.owns('flow-1', generation + 1)).toBe(false);
	});
});

describe('ClientHeldEncryptionKeys.dropGeneration', () => {
	it('drops the key its generation owns', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { generation } = await keyFor(keys);

		keys.dropGeneration('flow-1', generation);

		expect(keys.has('flow-1')).toBe(false);
	});

	it('leaves a newer request’s key alone when an older request cleans up', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const older = await keyFor(keys);
		const newer = await keyFor(keys);

		keys.dropGeneration('flow-1', older.generation);

		expect(keys.has('flow-1')).toBe(true);
		const jwe = await issuerEncrypt(newer.jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });
		await expect(keys.decrypt('flow-1', jwe, immediate)).resolves.toEqual({ credentialCount: 1 });
	});
});

describe('ClientHeldEncryptionKeys.decrypt', () => {
	const combos = RESPONSE_KEY_ALGS.flatMap((alg) => RESPONSE_ENCS.map((enc) => [alg, enc] as const));

	it.each(combos)('decrypts %s with %s', async (alg, enc) => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys, 'flow-1', alg, enc);
		const jwe = await issuerEncrypt(jwk, alg, enc, { credentials: [{ credential: ISSUED }] });

		await keys.decrypt('flow-1', jwe, immediate);

		expect(keys.response('flow-1')?.credentials).toEqual([ISSUED]);
	});

	it('tells the engine only how many credentials were issued, never their contents', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);
		const jwe = await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
			credentials: [{ credential: ISSUED }, { credential: 'second' }],
			notification_id: 'n-1',
			credential_metadata: seedMetadata,
		});

		const control = await keys.decrypt('flow-1', jwe, immediate);

		expect(control).toEqual({ credentialCount: 2 });
		expect(JSON.stringify(control)).not.toContain(ISSUED);
		expect(JSON.stringify(control)).not.toContain(SEED);
		expect(JSON.stringify(control)).not.toContain('n-1');
	});

	it('tells the engine only the transaction to poll for a pending answer', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		const control = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { transaction_id: 'tx-1', interval: 5 }),
			immediate,
		);

		expect(control).toEqual({ transactionId: 'tx-1', interval: 5 });
	});

	it('refuses an answer that is both credentials and a transaction, or neither', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		for (const body of [{ transaction_id: 'tx-1', credentials: [{ credential: ISSUED }] }, {}, { credentials: [] }]) {
			await expect(
				keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', body), immediate),
			).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		}
	});

	it('accepts 256 credentials and refuses 257', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);
		const many = (n: number) => Array.from({ length: n }, (_, i) => ({ credential: `c${i}` }));

		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { credentials: many(256) }), immediate),
		).resolves.toEqual({ credentialCount: 256 });
		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { credentials: many(257) }), immediate),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('requires the issuer JWE to use exactly the negotiated alg and enc', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys, 'flow-1', 'ECDH-ES+A256KW', 'A256GCM');
		const body = { credentials: [{ credential: ISSUED }] };

		for (const [alg, enc] of [
			['ECDH-ES', 'A256GCM'],
			['ECDH-ES+A128KW', 'A256GCM'],
			['ECDH-ES+A256KW', 'A128GCM'],
		] as const) {
			await expect(
				keys.decrypt('flow-1', await issuerEncrypt({ ...jwk, alg }, alg, enc, body), immediate),
			).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		}
		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A256GCM', body), immediate),
		).resolves.toEqual({ credentialCount: 1 });
	});

	it('refuses with a message that carries no contents when it cannot decrypt', async () => {
		const keys = new ClientHeldEncryptionKeys();
		await keyFor(keys);
		const other = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const wrongKey = await issuerEncrypt(
			{ ...(await exportJWK(other.publicKey)), alg: 'ECDH-ES' },
			'ECDH-ES',
			'A256GCM',
			{ credentials: [{ credential: ISSUED }] },
		);

		for (const jwe of [wrongKey, 'not.a.jwe', '']) {
			const error = await keys.decrypt('flow-1', jwe, immediate).catch((e) => e);
			expect(error).toBeInstanceOf(ClientHeldEncryptionError);
			expect(error.message).not.toContain(ISSUED);
			expect(error.message).not.toContain(jwe === '' ? 'never-matches' : jwe);
		}
	});

	it('refuses a decrypted body that is not a JSON object', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		await expect(
			keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', [ISSUED]), immediate),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('has no key after drop() or clear()', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);
		await keyFor(keys, 'flow-2');
		const jwe = await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] });

		keys.drop('flow-1');
		await expect(keys.decrypt('flow-1', jwe, immediate)).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		expect(keys.has('flow-2')).toBe(true);

		keys.clear();
		expect(keys.has('flow-2')).toBe(false);
	});
});

describe('credentials entries (OID4VCI 1.0 section 8.3)', () => {
	async function decryptBody(body: unknown) {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);
		const result = await keys.decrypt('flow-1', await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', body), immediate);
		return { keys, result };
	}

	it('stores the INNER credential value of each entry', async () => {
		const { keys } = await decryptBody({ credentials: [{ credential: 'first' }, { credential: 'second' }] });

		expect(keys.response('flow-1')?.credentials).toEqual(['first', 'second']);
	});

	it('stores the JSON of an object credential (ldp_vc), not its wrapper', async () => {
		const ldp = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'], id: 'urn:x' };
		const { keys } = await decryptBody({ credentials: [{ credential: ldp }] });

		expect(keys.response('flow-1')?.credentials).toEqual([JSON.stringify(ldp)]);
		expect(keys.response('flow-1')?.credentials[0]).not.toContain('"credential"');
	});

	it.each([
		['an unwrapped string', ['plain.credential']],
		['an entry without a credential member', [{ other: 1 }]],
		['an empty credential', [{ credential: '' }]],
		['a numeric credential', [{ credential: 7 }]],
		['a null credential', [{ credential: null }]],
		['an array credential', [{ credential: ['a'] }]],
		['a null entry', [null]],
		['a nested array entry', [['x']]],
	])('refuses %s', async (_label, credentials) => {
		await expect(decryptBody({ credentials })).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});

	it('refuses a credentials member that is not a list, and the retired singular credential member', async () => {
		await expect(decryptBody({ credentials: { credential: 'x' } })).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		await expect(decryptBody({ credential: 'single' })).rejects.toBeInstanceOf(ClientHeldEncryptionError);
	});
});

describe('secret seed and credential_metadata across responses (privatedata-spec 5A.2)', () => {
	it('accepts a seed on the immediate response that issues the credentials', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
				credentials: [{ credential: ISSUED }],
				credential_metadata: seedMetadata,
			}),
			immediate,
		);

		expect(keys.response('flow-1')?.credentialMetadata).toEqual(seedMetadata);
	});

	it('refuses a seed on a Deferred Credential Response', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		await expect(
			keys.decrypt(
				'flow-1',
				await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
					credentials: [{ credential: ISSUED }],
					credential_metadata: seedMetadata,
				}),
				deferred,
			),
		).rejects.toBeInstanceOf(ClientHeldEncryptionError);
		expect(keys.response('flow-1')).toBeUndefined();
	});

	it('refuses a seed on a pending response, deferred or not', async () => {
		for (const options of [immediate, deferred]) {
			const keys = new ClientHeldEncryptionKeys();
			const { jwk } = await keyFor(keys);

			await expect(
				keys.decrypt(
					'flow-1',
					await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
						transaction_id: 'tx-1',
						interval: 2,
						credential_metadata: seedMetadata,
					}),
					options,
				),
			).rejects.toBeInstanceOf(ClientHeldEncryptionError);
			expect(keys.response('flow-1')).toBeUndefined();
		}
	});

	it('does not carry credential_metadata or notification_id from a pending response to the deferred one', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);

		const pending = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
				transaction_id: 'tx-1',
				interval: 2,
				notification_id: 'n-pending',
				credential_metadata: { display: [{ name: 'pending' }] },
			}),
			immediate,
		);
		expect(pending).toEqual({ transactionId: 'tx-1', interval: 2 });
		expect(keys.response('flow-1')).toEqual({
			credentials: [],
			credentialMetadata: { display: [{ name: 'pending' }] },
			notificationId: 'n-pending',
		});

		const done = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { credentials: [{ credential: ISSUED }] }),
			deferred,
		);

		expect(done).toEqual({ credentialCount: 1 });
		expect(keys.response('flow-1')).toEqual({
			credentials: [ISSUED],
			credentialMetadata: undefined,
			notificationId: undefined,
		});
	});

	it('keeps repeating pending answers, then takes the deferred credentials with only their own metadata', async () => {
		const keys = new ClientHeldEncryptionKeys();
		const { jwk } = await keyFor(keys);
		const pending = (interval: number) =>
			issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', { transaction_id: 'tx-1', interval });

		expect(await keys.decrypt('flow-1', await pending(2), immediate)).toEqual({ transactionId: 'tx-1', interval: 2 });
		expect(await keys.decrypt('flow-1', await pending(5), deferred)).toEqual({ transactionId: 'tx-1', interval: 5 });
		const done = await keys.decrypt(
			'flow-1',
			await issuerEncrypt(jwk, 'ECDH-ES', 'A256GCM', {
				credentials: [{ credential: ISSUED }],
				notification_id: 'n-2',
				credential_metadata: { display: [{ name: 'done' }] },
			}),
			deferred,
		);

		expect(done).toEqual({ credentialCount: 1 });
		expect(keys.response('flow-1')).toEqual({
			credentials: [ISSUED],
			credentialMetadata: { display: [{ name: 'done' }] },
			notificationId: 'n-2',
		});
	});
});
