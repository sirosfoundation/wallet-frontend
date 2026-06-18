/**
 * WalletSigner — abstract signing interface for pluggable WSCD backends.
 *
 * This interface decouples the wallet's signing operations from a specific
 * cryptographic implementation. Implementations may use:
 * - WebCrypto (browser software keys)
 * - R2PS (remote HSM via WASM or HTTP bridge)
 * - Platform keystores (iOS Keychain, Android Keystore via native bridge)
 *
 * All keys are referenced by an opaque `kid` (key ID) string.
 */
import type { JWK } from "jose";

/**
 * WSCD certification information.
 * Either the string "none" for uncertified keys, or a structured object
 * identifying the certification scheme and assurance level (CS-04 §7.1.3).
 */
export type CertificationInfo =
	| "none"
	| { scheme: string; assurance_level: string };

export interface SecurityProperties {
	/** Key storage security level — ISO 18045 AVA_VAN scale values */
	key_storage: string[];
	/** ISO 18045 user authentication methods protecting key use */
	user_authentication: string[];
	/** Certification status of the WSCD (CS-04 §7.1.3, Annex C §C.3.1) */
	certification: CertificationInfo;
	/** RFC 8176 AMR values from the last signing operation */
	amr: string[];
}

export interface WalletSigner {
	/** Generate a new key pair and return its public key. */
	generateKey(algorithm: "ES256"): Promise<{ kid: string; publicKeyJwk: JWK }>;

	/** Sign arbitrary data with the specified key. Returns raw signature bytes. */
	sign(kid: string, data: Uint8Array): Promise<Uint8Array>;

	/** Export the public key JWK for a given key ID. */
	exportPublicKey(kid: string): Promise<JWK>;

	/** Delete a key. */
	deleteKey(kid: string): Promise<void>;

	/** Get the security properties for a key (for KA claim population). */
	securityProperties(kid: string): Promise<SecurityProperties>;
}
