// @vitest-environment happy-dom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as jose from "jose";
import { MemoryRouter } from "react-router-dom";

/**
 * happy-dom provides a `window` but no Web Storage, and `useStorage.ts` reads
 * `window.localStorage` at module scope — which is why LocalStorageKeystore
 * has had no tests at all. Install an in-memory Storage before any import
 * evaluates.
 */
vi.hoisted(() => {
	class MemoryStorage implements Storage {
		#entries = new Map<string, string>();
		get length() { return this.#entries.size; }
		key(index: number) { return [...this.#entries.keys()][index] ?? null; }
		getItem(name: string) { return this.#entries.has(name) ? this.#entries.get(name)! : null; }
		setItem(name: string, value: string) { this.#entries.set(name, String(value)); }
		removeItem(name: string) { this.#entries.delete(name); }
		clear() { this.#entries.clear(); }
	}

	for (const name of ["localStorage", "sessionStorage"] as const) {
		const storage = new MemoryStorage();
		Object.defineProperty(globalThis.window, name, { value: storage, configurable: true, writable: true });
		Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
	}
});

/** The encrypted container the keystore loads on mount, per test. */
const idbContent: { current: unknown } = { current: null };

vi.mock("@/hooks/useIndexedDb", () => ({
	useIndexedDb: () => ({
		read: vi.fn(async () => (idbContent.current ? { content: idbContent.current } : undefined)),
		write: vi.fn(async () => undefined),
		destroy: vi.fn(async () => undefined),
	}),
}));

import * as keystore from "@/services/keystore";
import { useLocalStorageKeystore } from "@/services/LocalStorageKeystore";
import { jsonStringifyTaggedBinary, toBase64Url } from "@/util";

const VCDM2_CONTEXT = "https://www.w3.org/ns/credentials/v2";
const USER_HANDLE = toBase64Url(new Uint8Array([1, 2, 3, 4]));

function enc(value: object): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The keystore calls useNavigate(), so it needs a Router in the tree. */
const routerWrapper = ({ children }: { children: React.ReactNode }) => (
	<MemoryRouter>{children}</MemoryRouter>
);

/**
 * Open the keystore the way a returning session does: a real encrypted
 * container in IndexedDB plus the user handle and exported main key in
 * session storage. The hook's mount effect then loads it, avoiding the
 * unlock/merge path, which is not what these tests are about.
 */
async function renderOpenedKeystore() {
	const { mainKey, keyInfo } = await keystore.initPassword("Asdf123!", { pbkdfIterations: 1000 });
	const { privateData } = await keystore.init(mainKey, keyInfo);
	const exportedMainKey = await keystore.exportMainKey(mainKey);

	idbContent.current = privateData;
	// The hook closes the session unless the *global* (localStorage) user
	// handle is present too — see the checkPrivateData effect.
	window.localStorage.setItem("userHandle", jsonStringifyTaggedBinary(USER_HANDLE));
	window.sessionStorage.setItem("userHandle", jsonStringifyTaggedBinary(USER_HANDLE));
	window.sessionStorage.setItem("mainKey", jsonStringifyTaggedBinary(new Uint8Array(exportedMainKey)));

	const { result } = renderHook(() => useLocalStorageKeystore(new EventTarget()), { wrapper: routerWrapper });

	await waitFor(() => expect(result.current.isOpen()).toBe(true));
	return result;
}

/** Mint a wallet keypair and commit it, so the folded state contains it. */
async function mintKeypair(result: { current: ReturnType<typeof useLocalStorageKeystore> }) {
	let publicKey: jose.JWK | undefined;
	await act(async () => {
		const [{ keypairs }, , commit] = await result.current.generateKeypairs(1);
		publicKey = keypairs[0].publicKey as jose.JWK;
		await commit();
	});
	return publicKey!;
}

function envelopedCredential(holderJwk: jose.JWK): string {
	return `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc({
		"@context": [VCDM2_CONTEXT],
		type: ["VerifiableCredential"],
		issuer: "did:example:issuer",
		credentialSubject: { id: "did:example:subject" },
		cnf: { jwk: holderJwk },
	})}.sig`;
}

describe("LocalStorageKeystore.signVcdm2Presentation", () => {
	beforeEach(() => {
		idbContent.current = null;
		window.sessionStorage.clear();
		window.localStorage.clear();
	});

	// Rendering useLocalStorageKeystore with an *open* keystore currently
	// re-renders without settling and exhausts the heap, so these three cannot
	// run yet. The scaffolding above (Storage polyfill, MemoryRouter, mocked
	// idb, seeded session/local user handle + main key) is what it takes to
	// open the keystore under test, and is kept so the suite can be enabled
	// once that loop is fixed. See the note in the accompanying report.
	it.skip("signs a presentation with the wallet key the credential is bound to", async () => {
		const result = await renderOpenedKeystore();
		const publicKey = await mintKeypair(result);

		let vpjwt: string | undefined;
		await act(async () => {
			({ vpjwt } = await result.current.signVcdm2Presentation(
				"nonce-1",
				"https://verifier.example",
				[envelopedCredential(publicKey)],
			));
		});

		expect(vpjwt).toBeDefined();
		const payload = jose.decodeJwt(vpjwt!) as any;
		expect(payload.type).toEqual(["VerifiablePresentation"]);
		expect(payload.nonce).toBe("nonce-1");
		expect(payload.aud).toBe("https://verifier.example");
		expect(payload.verifiableCredential[0].type).toBe("EnvelopedVerifiableCredential");

		// Signed by the very key the credential was bound to.
		const verifyKey = await jose.importJWK(publicKey, "ES256");
		await expect(jose.jwtVerify(vpjwt!, verifyKey)).resolves.toBeDefined();
	});

	it.skip("passes transaction data parameters through", async () => {
		const result = await renderOpenedKeystore();
		const publicKey = await mintKeypair(result);

		let vpjwt: string | undefined;
		await act(async () => {
			({ vpjwt } = await result.current.signVcdm2Presentation(
				"n", "aud", [envelopedCredential(publicKey)],
				{ transaction_data_hashes: ["h1"], transaction_data_hashes_alg: ["sha-256"] },
			));
		});

		const payload = jose.decodeJwt(vpjwt!) as any;
		expect(payload.transaction_data_hashes).toEqual(["h1"]);
		expect(payload.transaction_data_hashes_alg).toEqual(["sha-256"]);
	});

	it.skip("surfaces a credential the wallet holds no key for", async () => {
		const result = await renderOpenedKeystore();
		await mintKeypair(result);

		const foreign = await jose.exportJWK(
			(await jose.generateKeyPair("ES256", { extractable: true })).publicKey,
		);

		await expect(
			result.current.signVcdm2Presentation("n", "aud", [envelopedCredential(foreign)]),
		).rejects.toThrow(/Key pair not found for kid/);
	});

	it("refuses to sign while the keystore is closed", async () => {
		const { result } = renderHook(() => useLocalStorageKeystore(new EventTarget()), { wrapper: routerWrapper });

		await expect(
			result.current.signVcdm2Presentation("n", "aud", ["anything"]),
		).rejects.toThrow(/Key store is closed/);
	});
});
