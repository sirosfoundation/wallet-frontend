import { describe, it, expect } from 'vitest';
import {
	generateKeyPair,
	exportJWK,
	importJWK,
	SignJWT,
	jwtVerify,
	type JWK,
} from 'jose';
import {
	OIDFlowClientAuthMaterial,
	type ClientAuthKeyPair,
	type SerializedClientAuthMaterial,
} from './OIDFlowClientAuthMaterial';

async function makeKeyPair(): Promise<ClientAuthKeyPair> {
	const { privateKey, publicKey } = await generateKeyPair('ES256', {
		extractable: true,
	});
	const publicKeyJwk = await exportJWK(publicKey);
	return { privateKey, publicKeyJwk };
}

// Compare only the cryptographic components — exportJWK can attach environment
// metadata (ext/key_ops) that isn't meaningful for equality.
function coreJwk(jwk: JWK) {
	const { kty, crv, x, y, d } = jwk;
	return { kty, crv, x, y, d };
}

describe('OIDFlowClientAuthMaterial', () => {
	describe('serialize', () => {
		it('produces a JSON-safe shape with the private key as a JWK', async () => {
			const keyPair = await makeKeyPair();
			const material = new OIDFlowClientAuthMaterial(
				'dpop-id-1',
				keyPair,
				'wia.jwt',
			);

			const serialized = await material.serialize();

			expect(serialized.dpopKeyId).toBe('dpop-id-1');
			expect(serialized.wia).toBe('wia.jwt');
			expect(coreJwk(serialized.publicJwk)).toEqual(
				coreJwk(keyPair.publicKeyJwk),
			);
			expect(serialized.privateJwk.d).toBeTruthy(); // carries the private scalar
			expect(() => JSON.stringify(serialized)).not.toThrow();
		});

		it('omits wia when not set', async () => {
			const material = new OIDFlowClientAuthMaterial(
				'dpop-id-2',
				await makeKeyPair(),
			);
			const serialized = await material.serialize();
			expect(serialized.wia).toBeUndefined();
		});
	});

	describe('fromSerialized', () => {
		it('round-trips: serialize -> fromSerialized -> serialize is stable', async () => {
			const original = new OIDFlowClientAuthMaterial(
				'dpop-id-3',
				await makeKeyPair(),
				'wia.jwt',
			);

			const serialized = await original.serialize();
			const restored =
				await OIDFlowClientAuthMaterial.fromSerialized(serialized);
			const reserialized = await restored.serialize();

			expect(restored.dpopKeyId).toBe('dpop-id-3');
			expect(restored.wia).toBe('wia.jwt');
			expect(coreJwk(reserialized.privateJwk)).toEqual(
				coreJwk(serialized.privateJwk),
			);
			expect(coreJwk(reserialized.publicJwk)).toEqual(
				coreJwk(serialized.publicJwk),
			);
		});

		it('round-trips through JSON (the sessionStorage path)', async () => {
			const original = new OIDFlowClientAuthMaterial(
				'dpop-id-4',
				await makeKeyPair(),
			);
			const serialized = await original.serialize();

			const throughJson = JSON.parse(
				JSON.stringify(serialized),
			) as SerializedClientAuthMaterial;
			const restored =
				await OIDFlowClientAuthMaterial.fromSerialized(throughJson);

			expect(restored.dpopKeyId).toBe('dpop-id-4');
			expect(restored.wia).toBeUndefined();
			expect(coreJwk((await restored.serialize()).privateJwk)).toEqual(
				coreJwk(serialized.privateJwk),
			);
		});

		it('restores a private key that can still sign, verifiable by the public JWK', async () => {
			const original = new OIDFlowClientAuthMaterial(
				'dpop-id-5',
				await makeKeyPair(),
			);
			const serialized = await original.serialize();
			const restored =
				await OIDFlowClientAuthMaterial.fromSerialized(serialized);

			const jwt = await new SignJWT({ hello: 'world' })
				.setProtectedHeader({ alg: 'ES256' })
				.sign(restored.keyPair.privateKey);

			const publicKey = await importJWK(restored.keyPair.publicKeyJwk, 'ES256');
			const { payload } = await jwtVerify(jwt, publicKey);
			expect(payload.hello).toBe('world');
		});
	});
});
