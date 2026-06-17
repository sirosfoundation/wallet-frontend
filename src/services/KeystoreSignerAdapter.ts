/**
 * KeystoreSignerAdapter — bridges the existing keystore.ts into the WalletSigner interface.
 *
 * This adapter wraps the current keystore's raw JWK-based signing with the
 * pluggable WalletSigner interface. Existing code continues to use keystore.ts
 * directly; new code paths (e.g. R2PS, native WSCD) use WalletSigner.
 *
 * For the default WebCrypto path, this adapter reads keys from the wallet state
 * container and signs using `crypto.subtle`.
 */
import * as jose from "jose";
import type { JWK } from "jose";
import type { SecurityProperties, WalletSigner } from "./walletSigner";
import type { CredentialKeyPair } from "./keystore";
import type { CurrentSchema } from "./WalletStateSchema";

type WalletState = CurrentSchema.WalletState;

/**
 * Create a WalletSigner that delegates to the current wallet state container.
 *
 * The `getState` callback returns the current wallet state on each call,
 * ensuring the signer always uses the latest keys.
 */
export class KeystoreSignerAdapter implements WalletSigner {
	constructor(
		private getState: () => WalletState,
		private updateState: (keypair: CredentialKeyPair) => Promise<void>,
	) {}

	async generateKey(algorithm: "ES256"): Promise<{ kid: string; publicKeyJwk: JWK }> {
		if (algorithm !== "ES256") {
			throw new Error(`Unsupported algorithm: ${algorithm}`);
		}

		const { publicKey, privateKey } = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign"],
		);

		const publicKeyJwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JWK;
		const privateKeyJwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JWK;

		const kid = await jose.calculateJwkThumbprint(publicKeyJwk, "sha256");

		// Store in wallet state via callback
		const keypair: CredentialKeyPair = {
			kid,
			did: "", // DID assigned separately in the issuance flow
			alg: "ES256",
			publicKey: publicKeyJwk,
			privateKey: privateKeyJwk,
		};
		await this.updateState(keypair);

		return { kid, publicKeyJwk };
	}

	async sign(kid: string, data: Uint8Array): Promise<Uint8Array> {
		const keypair = this.findKeypair(kid);
		if (keypair.keypair.signerRef) {
			throw new Error(
				`Key ${kid} uses a non-extractable signer (ref: ${keypair.keypair.signerRef}). ` +
				`Use the appropriate WalletSigner backend instead of KeystoreSignerAdapter.`
			);
		}
		if (!keypair.keypair.privateKey?.d) {
			throw new Error(`Key ${kid} has no private key material (missing 'd' component)`);
		}
		const cryptoKey = await crypto.subtle.importKey(
			"jwk",
			keypair.keypair.privateKey,
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
		const keypair = this.findKeypair(kid);
		const { d: _, ...publicJwk } = keypair.keypair.publicKey as JWK & { d?: string };
		return publicJwk;
	}

	async deleteKey(_kid: string): Promise<void> {
		// Key deletion is handled through wallet state events via keystore.ts.
		// This adapter doesn't own the lifecycle — callers should use the
		// keystore's updateWalletState flow directly for key removal.
		throw new Error("Use keystore.ts updateWalletState for key deletion");
	}

	async securityProperties(_kid: string): Promise<SecurityProperties> {
		// WebCrypto software keys — static properties
		return {
			key_storage: "software",
			user_authentication: [],
			certification: "none",
			amr: ["swk"],
		};
	}

	private findKeypair(kid: string): { kid: string; keypair: CredentialKeyPair } {
		const state = this.getState();
		const entry = state.keypairs.find((k) => k.kid === kid);
		if (!entry) {
			throw new Error(`Key pair not found for kid: ${kid}`);
		}
		return entry;
	}
}
