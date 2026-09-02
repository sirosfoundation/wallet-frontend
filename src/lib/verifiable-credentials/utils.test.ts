import { describe, expect, it } from 'vitest';
import * as jose from 'jose';
import { COSEKeyToJWK } from 'cose-kit';
import { cborEncode, DataItem } from '@auth0/mdl/lib/cbor';
import { VerifiableCredentialFormat } from 'wallet-common';
import { fromBase64Url, toBase64Url } from '@/util';
import { deriveHolderKidFromCredential } from './utils';

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

function buildJwtCredential(payloadObj: Record<string, unknown>): string {
	const enc = (obj: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
	return `${enc({ alg: 'ES256', typ: 'JWT' })}.${enc(payloadObj)}.signature`;
}

async function generateEcKeyMaterial(): Promise<{
	jwk: jose.JWK;
	coseKey: Map<number, number | Uint8Array>;
}> {
	const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify',
	]);
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
