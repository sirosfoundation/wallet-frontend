import { describe, expect, it } from "vitest";
import * as jose from "jose";
import { signVcdm2Presentation } from "./keystore";

/**
 * `signVcdm2Presentation` only reads `keypairs` off the calculated wallet
 * state, so the private data and main key can be placeholders — the parts
 * under test are holder-key selection, presentation construction, and the
 * enveloping JWS.
 */

const VCDM2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

function enc(value: object): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeHolderKeypair() {
	const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
	const publicJwk = await jose.exportJWK(publicKey);
	const privateJwk = await jose.exportJWK(privateKey);
	const kid = await jose.calculateJwkThumbprint(publicJwk, "sha256");

	return {
		publicJwk,
		state: {
			keypairs: [{
				kid,
				keypair: {
					kid,
					did: `did:jwk:${kid}`,
					alg: "ES256",
					publicKey: publicJwk,
					privateKey: privateJwk,
				},
			}],
		},
	};
}

function container(state: unknown) {
	return [{} as any, {} as any, state as any] as [any, any, any];
}

const credentialBody = (holderJwk?: jose.JWK) => ({
	"@context": [VCDM2_CONTEXT],
	type: ["VerifiableCredential", "DiplomaCredential"],
	issuer: "did:example:issuer",
	credentialSubject: { id: "did:example:subject" },
	...(holderJwk ? { cnf: { jwk: holderJwk } } : {}),
});

describe("signVcdm2Presentation", () => {
	it("envelopes an enveloped credential as an EnvelopedVerifiableCredential", async () => {
		const { publicJwk, state } = await makeHolderKeypair();
		const raw = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(credentialBody(publicJwk))}.sig`;

		const { vpjwt } = await signVcdm2Presentation(container(state), "n-123", "https://verifier.example", [raw]);

		const header = jose.decodeProtectedHeader(vpjwt);
		expect(header.typ).toBe("vp+jwt");
		expect((header.jwk as jose.JWK)?.d).toBeUndefined();

		const payload = jose.decodeJwt(vpjwt) as any;
		expect(payload["@context"]).toEqual([VCDM2_CONTEXT]);
		expect(payload.type).toEqual(["VerifiablePresentation"]);
		expect(payload.nonce).toBe("n-123");
		expect(payload.aud).toBe("https://verifier.example");
		expect(payload.holder).toBe("did:example:subject");
		expect(payload.verifiableCredential[0].type).toBe("EnvelopedVerifiableCredential");
		expect(payload.verifiableCredential[0].id).toBe(`data:application/vc+jwt,${raw}`);
	});

	it("produces a presentation the holder key actually verifies", async () => {
		const { publicJwk, state } = await makeHolderKeypair();
		const raw = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(credentialBody(publicJwk))}.sig`;

		const { vpjwt } = await signVcdm2Presentation(container(state), "n", "aud", [raw]);

		const key = await jose.importJWK(publicJwk, "ES256");
		await expect(jose.jwtVerify(vpjwt, key)).resolves.toBeDefined();
	});

	it("embeds a Data Integrity credential directly, binding via a did:key subject", async () => {
		// did:key for an Ed25519 holder key; the wallet keypair is looked up
		// by the thumbprint of that key.
		const raw = new Uint8Array(32).fill(9);
		const multikey = new Uint8Array([0xed, 0x01, ...raw]);
		let binary = "";
		for (const b of multikey) binary += String.fromCharCode(b);
		const did = `did:key:u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

		const holderJwk = {
			kty: "OKP",
			crv: "Ed25519",
			x: btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
		} as jose.JWK;
		const kid = await jose.calculateJwkThumbprint(holderJwk, "sha256");

		// The signing key is a P-256 wallet key registered under that kid.
		const { privateKey, publicKey } = await jose.generateKeyPair("ES256", { extractable: true });
		const state = {
			keypairs: [{
				kid,
				keypair: {
					kid,
					did,
					alg: "ES256",
					publicKey: await jose.exportJWK(publicKey),
					privateKey: await jose.exportJWK(privateKey),
				},
			}],
		};

		const credential = {
			"@context": [VCDM2_CONTEXT],
			type: ["VerifiableCredential"],
			issuer: "did:example:issuer",
			credentialSubject: { id: did },
		};

		const { vpjwt } = await signVcdm2Presentation(container(state), "n", "aud", [credential]);
		const payload = jose.decodeJwt(vpjwt) as any;

		expect(payload.verifiableCredential[0]).toEqual(credential);
		expect(payload.holder).toBe(did);
	});

	it("passes transaction data parameters through", async () => {
		const { publicJwk, state } = await makeHolderKeypair();
		const raw = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(credentialBody(publicJwk))}.sig`;

		const { vpjwt } = await signVcdm2Presentation(container(state), "n", "aud", [raw], {
			transaction_data_hashes: ["abc"],
			transaction_data_hashes_alg: ["sha-256"],
		});

		const payload = jose.decodeJwt(vpjwt) as any;
		expect(payload.transaction_data_hashes).toEqual(["abc"]);
		expect(payload.transaction_data_hashes_alg).toEqual(["sha-256"]);
	});

	it("refuses an empty presentation", async () => {
		const { state } = await makeHolderKeypair();
		await expect(signVcdm2Presentation(container(state), "n", "aud", []))
			.rejects.toThrow(/at least one credential/);
	});

	it("refuses a credential with no holder binding", async () => {
		const { state } = await makeHolderKeypair();
		const raw = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(credentialBody())}.sig`;

		await expect(signVcdm2Presentation(container(state), "n", "aud", [raw]))
			.rejects.toThrow(/Holder public key could not be resolved/);
	});

	it("refuses when no wallet keypair matches the credential's holder key", async () => {
		const other = await jose.generateKeyPair("ES256", { extractable: true });
		const foreignJwk = await jose.exportJWK(other.publicKey);
		const { state } = await makeHolderKeypair();
		const raw = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(credentialBody(foreignJwk))}.sig`;

		await expect(signVcdm2Presentation(container(state), "n", "aud", [raw]))
			.rejects.toThrow(/Key pair not found for kid/);
	});
});
