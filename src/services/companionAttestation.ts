/**
 * Integration with the Wallet Companion browser extension for Tier 2 attestation.
 *
 * When the extension is installed, provides:
 * - Extension attestation key for WIA binding
 * - Challenge signing for proving extension presence
 *
 * Falls back gracefully when the extension is not installed.
 */

interface WalletCompanionAPI {
	isInstalled: boolean;
	getAttestationKey(): Promise<{ kid: string; publicKeyJwk: JsonWebKey } | null>;
	signWiaChallenge(challenge: string): Promise<string>;
}

declare global {
	interface Window {
		WalletCompanion?: WalletCompanionAPI;
	}
}

/**
 * Check if the Wallet Companion extension is available.
 */
export function isCompanionAvailable(): boolean {
	return typeof window !== 'undefined' && !!window.WalletCompanion?.isInstalled;
}

/**
 * Get the extension's attestation public key.
 * Returns null if the extension is not installed or key is not available.
 */
export async function getCompanionAttestationKey(): Promise<{
	kid: string;
	publicKeyJwk: JsonWebKey;
} | null> {
	if (!isCompanionAvailable()) return null;
	try {
		return await window.WalletCompanion!.getAttestationKey();
	} catch {
		return null;
	}
}

/**
 * Sign a WIA challenge using the companion extension's attestation key.
 * Returns null if the extension is not available.
 */
export async function signWiaChallengeWithCompanion(
	challenge: string,
): Promise<string | null> {
	if (!isCompanionAvailable()) return null;
	try {
		return await window.WalletCompanion!.signWiaChallenge(challenge);
	} catch (error) {
		console.warn('Companion WIA challenge signing failed:', error);
		return null;
	}
}
