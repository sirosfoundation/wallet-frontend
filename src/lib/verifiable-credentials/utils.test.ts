import { describe, expect, it } from 'vitest';
import * as jose from 'jose';
import { COSEKeyToJWK } from 'cose-kit';
import { cborEncode, DataItem } from '@auth0/mdl/lib/cbor';
import { VerifiableCredentialFormat } from 'wallet-common';
import { fromBase64Url, toBase64Url } from '@/lib/utils';
import { deriveHolderKidFromCredential, getTokenStatusListEntity } from './utils';

describe('deriveHolderKidFromCredential', () => {
	describe('JWT-based formats', () => {
		for (const format of [
			VerifiableCredentialFormat.VC_SDJWT,
			VerifiableCredentialFormat.DC_SDJWT,
			VerifiableCredentialFormat.JWT_VC_JSON,
		]) {
			it(`derives the kid from cnf.jwk for ${format}`, async () => {
				const { jwk } = await generateEcKeyMaterial();
				const credential = buildJwtCredential({ cnf: { jwk } });

				const kid = await deriveHolderKidFromCredential(credential, format);

				expect(kid).toBe(await jose.calculateJwkThumbprint(jwk, 'sha256'));
			});
		}

		it('returns undefined when cnf is absent', async () => {
			const credential = buildJwtCredential({ sub: 'no-cnf-here' });

			const kid = await deriveHolderKidFromCredential(
				credential,
				VerifiableCredentialFormat.VC_SDJWT,
			);

			expect(kid).toBeUndefined();
		});

		it('returns undefined when the payload segment is missing', async () => {
			const kid = await deriveHolderKidFromCredential(
				'only-one-segment',
				VerifiableCredentialFormat.JWT_VC_JSON,
			);

			expect(kid).toBeUndefined();
		});

		it('returns undefined when the payload is not valid JSON', async () => {
			const header = toBase64Url(new TextEncoder().encode('{}'));
			const garbage = toBase64Url(new TextEncoder().encode('not json'));

			const kid = await deriveHolderKidFromCredential(
				`${header}.${garbage}.sig`,
				VerifiableCredentialFormat.DC_SDJWT,
			);

			expect(kid).toBeUndefined();
		});
	});

	describe('MSO_MDOC format', () => {
		it('derives the kid from the device key of a full mdoc document', async () => {
			const { coseKey } = await generateEcKeyMaterial();
			const credential = buildMdocCredential(coseKey);

			const kid = await deriveHolderKidFromCredential(
				credential,
				VerifiableCredentialFormat.MSO_MDOC,
			);

			expect(kid).toBe(await jose.calculateJwkThumbprint(COSEKeyToJWK(coseKey), 'sha256'));
		});

		it('derives the kid from a bare IssuerSigned structure', async () => {
			const { coseKey } = await generateEcKeyMaterial();
			const credential = buildMdocCredential(coseKey, undefined, { bare: true });

			const kid = await deriveHolderKidFromCredential(
				credential,
				VerifiableCredentialFormat.MSO_MDOC,
			);

			expect(kid).toBe(await jose.calculateJwkThumbprint(COSEKeyToJWK(coseKey), 'sha256'));
		});

		it('returns undefined when the MSO cannot be decoded', async () => {
			const { coseKey } = await generateEcKeyMaterial();
			const credential = buildMdocCredential(coseKey, cborEncode(42));

			const kid = await deriveHolderKidFromCredential(
				credential,
				VerifiableCredentialFormat.MSO_MDOC,
			);

			expect(kid).toBeUndefined();
		});
	});
});

describe('getTokenStatusListEntity', () => {
	const status = { status_list: { uri: 'https://issuer.example/lists/1', idx: 7 } };
	const expected = { uri: 'https://issuer.example/lists/1', idx: 7, iat: 1_700_000_000 };

	it('reads status and iat from the issuer JWT of an SD-JWT', () => {
		const credential = `${buildJwtCredential({ status, iat: 1_700_000_000 })}~disclosure~`;

		expect(getTokenStatusListEntity(credential, VerifiableCredentialFormat.DC_SDJWT)).toEqual(expected);
	});

	it('reads a plain JWT credential, also when the format is unknown', () => {
		const credential = buildJwtCredential({ status, iat: 1_700_000_000 });

		expect(getTokenStatusListEntity(credential, VerifiableCredentialFormat.JWT_VC_JSON)).toEqual(expected);
		expect(getTokenStatusListEntity(credential, '')).toEqual(expected);
	});

	it('reads an enveloped VCDM 2.0 credential', () => {
		const credential = buildJwtCredential({ status, iat: 1_700_000_000 }, 'vc+jwt');

		expect(getTokenStatusListEntity(credential, VerifiableCredentialFormat.VCDM2_JOSE)).toEqual(expected);
	});

	it('floors a fractional iat and leaves a missing one undefined', () => {
		const fractional = buildJwtCredential({ status, iat: 1_700_000_000.9 });
		const missing = buildJwtCredential({ status });

		expect(getTokenStatusListEntity(fractional, VerifiableCredentialFormat.DC_SDJWT)?.iat).toBe(1_700_000_000);
		expect(getTokenStatusListEntity(missing, VerifiableCredentialFormat.DC_SDJWT)?.iat).toBeUndefined();
	});

	it('returns undefined without a status list reference', () => {
		const credential = buildJwtCredential({ iat: 1_700_000_000 });

		expect(getTokenStatusListEntity(credential, VerifiableCredentialFormat.DC_SDJWT)).toBeUndefined();
	});

	it('returns undefined for ldp_vc and for data it cannot decode', () => {
		const credential = buildJwtCredential({ status });

		expect(getTokenStatusListEntity(credential, VerifiableCredentialFormat.LDP_VC)).toBeUndefined();
		expect(getTokenStatusListEntity('not-a-credential', VerifiableCredentialFormat.DC_SDJWT)).toBeUndefined();
		expect(getTokenStatusListEntity('not-a-credential', VerifiableCredentialFormat.MSO_MDOC)).toBeUndefined();
	});
});

function buildJwtCredential(payloadObj: Record<string, unknown>, typ = 'JWT'): string {
	const enc = (obj: unknown) =>
		toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
	return `${enc({ alg: 'ES256', typ })}.${enc(payloadObj)}.signature`;
}

async function generateEcKeyMaterial(): Promise<{
	jwk: jose.JWK;
	coseKey: Map<number, number | Uint8Array>;
}> {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as jose.JWK;
	const coseKey = new Map<number, number | Uint8Array>([
		[1, 2], // kty: EC2
		[-1, 1], // crv: P-256
		[-2, fromBase64Url(jwk.x!)], // x
		[-3, fromBase64Url(jwk.y!)], // y
	]);
	return { jwk, coseKey };
}

function cborToBase64Url(value: unknown): string {
	const encoded = cborEncode(value);
	const bytes = new Uint8Array(encoded.length);
	bytes.set(encoded);
	return toBase64Url(bytes);
}

function buildMdocCredential(
	coseKey: Map<number, number | Uint8Array>,
	msoPayload?: Uint8Array,
	{ bare = false }: { bare?: boolean } = {},
): string {
	const mso = new Map<string, unknown>([
		['deviceKeyInfo', new Map<string, unknown>([['deviceKey', coseKey]])],
	]);
	const issuerAuthPayload = msoPayload ?? cborEncode(DataItem.fromData(mso));
	const issuerAuth = [new Uint8Array(0), {}, issuerAuthPayload, new Uint8Array(64)];

	if (bare) {
		return cborToBase64Url(new Map<string, unknown>([['issuerAuth', issuerAuth]]));
	}

	const document = new Map<string, unknown>([
		['issuerSigned', new Map<string, unknown>([['issuerAuth', issuerAuth]])],
	]);
	return cborToBase64Url(new Map<string, unknown>([['documents', [document]]]));
}
