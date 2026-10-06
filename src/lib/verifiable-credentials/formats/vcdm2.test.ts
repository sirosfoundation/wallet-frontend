import { describe, expect, it } from 'vitest';
import { base64url, calculateJwkThumbprint, type JWK } from 'jose';
import { prepareVcdm2Presentation } from './vcdm2';

function b64url(value: object): string {
	return base64url.encode(JSON.stringify(value));
}

function decode(part: string): Record<string, any> {
	return JSON.parse(new TextDecoder().decode(base64url.decode(part)));
}

const holderJwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };

/** Enveloped VCDM 2.0 credential (vc+jwt), optionally carrying a cnf holder binding. */
function envelopedVc(payloadExtras: Record<string, unknown> = {}): string {
	const payload = {
		'@context': ['https://www.w3.org/ns/credentials/v2'],
		type: ['VerifiableCredential'],
		issuer: 'did:example:issuer',
		credentialSubject: { id: 'did:example:holder' },
		...payloadExtras,
	};
	return `${b64url({ alg: 'ES256', typ: 'vc+jwt' })}.${b64url(payload)}.sig`;
}

describe('prepareVcdm2Presentation', () => {
	it('returns the holder thumbprint as the kid', async () => {
		const credential = envelopedVc({ cnf: { jwk: holderJwk } });

		const { kid } = await prepareVcdm2Presentation(
			[credential],
			'nonce',
			'aud',
		);

		expect(kid).toBe(await calculateJwkThumbprint(holderJwk as JWK, 'sha256'));
	});

	it('produces a signing input with a vp+jwt / ES256 header carrying the public holder key', async () => {
		const credential = envelopedVc({ cnf: { jwk: holderJwk } });

		const { signingInput } = await prepareVcdm2Presentation(
			[credential],
			'nonce',
			'aud',
		);
		const [header] = signingInput.split('.');

		expect(decode(header)).toEqual({
			typ: 'vp+jwt',
			alg: 'ES256',
			jwk: holderJwk,
		});
	});

	it('embeds the nonce, audience and an issued-at timestamp in the payload', async () => {
		const credential = envelopedVc({ cnf: { jwk: holderJwk } });

		const { signingInput } = await prepareVcdm2Presentation(
			[credential],
			'the-nonce',
			'the-aud',
		);
		const payload = decode(signingInput.split('.')[1]);

		expect(payload.nonce).toBe('the-nonce');
		expect(payload.aud).toBe('the-aud');
		expect(payload.type).toEqual(['VerifiablePresentation']);
		expect(typeof payload.iat).toBe('number');
	});

	it('strips private key material from the header jwk', async () => {
		const credential = envelopedVc({
			cnf: { jwk: { ...holderJwk, d: 'secret' } },
		});

		const { signingInput } = await prepareVcdm2Presentation(
			[credential],
			'nonce',
			'aud',
		);
		const header = decode(signingInput.split('.')[0]);

		expect(header.jwk.d).toBeUndefined();
	});

	it('merges transaction data response params into the payload', async () => {
		const credential = envelopedVc({ cnf: { jwk: holderJwk } });
		const txParams = {
			transaction_data_hashes: ['hash'],
			transaction_data_hashes_alg: ['sha-256'],
		};

		const { signingInput } = await prepareVcdm2Presentation(
			[credential],
			'nonce',
			'aud',
			txParams,
		);
		const payload = decode(signingInput.split('.')[1]);

		expect(payload.transaction_data_hashes).toEqual(['hash']);
		expect(payload.transaction_data_hashes_alg).toEqual(['sha-256']);
	});

	it('throws when the holder key cannot be resolved', async () => {
		await expect(
			prepareVcdm2Presentation([envelopedVc()], 'nonce', 'aud'),
		).rejects.toThrow(/Holder public key could not be resolved/);
	});

	it('throws when credentials are bound to different holder keys', async () => {
		const first = envelopedVc({ cnf: { jwk: holderJwk } });
		const second = envelopedVc({ cnf: { jwk: { ...holderJwk, x: 'xyz' } } });

		await expect(
			prepareVcdm2Presentation([first, second], 'nonce', 'aud'),
		).rejects.toThrow(/same holder key/);
	});
});
