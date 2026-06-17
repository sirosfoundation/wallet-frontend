/**
 * WebCryptoSigner — WalletSigner backed by the Web Crypto API.
 *
 * This extracts the existing WebCrypto signing logic from keystore.ts into
 * a pluggable implementation. Keys are stored as raw JWK in the wallet state.
 */
import * as jose from "jose";
import type { JWK } from "jose";
import type { SecurityProperties, WalletSigner } from "./walletSigner";

type KeyStore = {
	getPrivateKey(kid: string): JWK | undefined;
	setKeyPair(kid: string, publicKey: JWK, privateKey: JWK): void;
	removeKey(kid: string): void;
};

/**
 * WebCryptoSigner uses the browser's SubtleCrypto API for P-256/ES256 operations.
 *
 * The `keyStore` parameter is an adapter that reads/writes keys to the wallet
 * state container. This keeps the signer stateless — persistence is external.
 */
export class WebCryptoSigner implements WalletSigner {
	constructor(private keyStore: KeyStore) {}

	async generateKey(algorithm: "ES256"): Promise<{ kid: string; publicKeyJwk: JWK }> {
		if (algorithm !== "ES256") {
			throw new Error(`Unsupported algorithm: ${algorithm}`);
		}

		const { publicKey, privateKey } = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);

		const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
		const privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);

		// Compute JWK Thumbprint as kid
		const kid = await jose.calculateJwkThumbprint(publicKeyJwk as JWK, "sha256");

		this.keyStore.setKeyPair(kid, publicKeyJwk as JWK, privateKeyJwk as JWK);

		return { kid, publicKeyJwk: publicKeyJwk as JWK };
	}

	async sign(kid: string, data: Uint8Array): Promise<Uint8Array> {
		const privateKeyJwk = this.keyStore.getPrivateKey(kid);
		if (!privateKeyJwk) {
			throw new Error(`Key not found: ${kid}`);
		}
		if (!privateKeyJwk.d) {
			throw new Error(`Key ${kid} has no private key material (missing 'd' component). Non-extractable keys require a different signer.`);
		}

		const cryptoKey = await crypto.subtle.importKey(
			"jwk",
			privateKeyJwk,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign"],
		);

		const signature = await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			cryptoKey,
			data,
		);

		return new Uint8Array(signature);
	}

	async exportPublicKey(kid: string): Promise<JWK> {
		const privateKeyJwk = this.keyStore.getPrivateKey(kid);
		if (!privateKeyJwk) {
			throw new Error(`Key not found: ${kid}`);
		}
		// Return public-only JWK (strip private component)
		const { d: _d, ...publicKeyJwk } = privateKeyJwk;
		return publicKeyJwk;
	}

	async deleteKey(kid: string): Promise<void> {
		this.keyStore.removeKey(kid);
	}

	async securityProperties(_kid: string): Promise<SecurityProperties> {
		return {
			key_storage: "software",
			user_authentication: [],
			certification: "none",
			amr: ["swk"],
		};
	}
}
