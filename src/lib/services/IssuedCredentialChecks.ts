/**
 * The two checks on a credential as it arrives from an issuer.
 *
 * Everything earlier in the issuance flow — the issuer's trust evaluation, its
 * entitlement to issue under ARF v3.0.0 §6.6.2.3, which type metadata to apply
 * — is decided from the type the issuer *advertised* in its credential
 * configuration. Nothing looked at what actually turned up, so an issuer could
 * advertise one attestation type and deliver another, and every one of those
 * decisions would stand, made about the wrong credential.
 *
 * Mirrors `verifyIssuedType` / `verifyVctIntegrity` in siros-sdk-kotlin and
 * siros-sdk-swift, so the three wallets refuse the same things.
 */

import { CredentialParsingError } from 'wallet-common';
import type { MetadataWarning } from 'wallet-common';

/**
 * Whether the credential's own declared type matches the one that was offered.
 *
 * `authorised` is the `vct` the engine reports alongside each credential, which
 * it reads from the offered credential configuration in the issuer's metadata —
 * so it is the advertised type, not another reading of the credential.
 * `declared` comes from the parsed credential itself.
 *
 * Returns a reason to refuse, or null when there is nothing to object to.
 * A type missing on either side is not a mismatch: as everywhere else in this
 * path, a check that could not run must not become a refusal.
 */
export function issuedTypeMismatch(
	authorised: string | undefined | null,
	declared: string | undefined | null,
): string | null {
	if (!authorised || !declared || authorised === declared) {
		return null;
	}
	return `Issuer delivered a '${declared}' credential, but this offer was for '${authorised}'`;
}

/**
 * The `vct` a parsed credential declares, if it declares one.
 *
 * The parsed-metadata type is a union across formats and the mdoc arm has no
 * `vct`, so this narrows rather than asserting - an mdoc simply has no vct to
 * compare, which `issuedTypeMismatch` already treats as nothing to object to.
 */
export function declaredVct(credentialMetadata: unknown): string | undefined {
	if (typeof credentialMetadata !== 'object' || credentialMetadata === null) return undefined;
	const vct = (credentialMetadata as Record<string, unknown>).vct;
	return typeof vct === 'string' && vct !== '' ? vct : undefined;
}

/**
 * Whether the credential's type metadata failed the digest its issuer pinned.
 *
 * `vct#integrity` exists so the *issuer* decides what a credential type means.
 * wallet-common verifies it while resolving the metadata, but reports a failure
 * as a `CredentialParsingError.IntegrityFail` warning — and warnings only reach
 * the user when `DISPLAY_ISSUANCE_WARNINGS` is on, which it is not by default.
 * A digest the issuer published and the metadata does not match is not a
 * display nicety, so it is treated here as a refusal regardless of that flag,
 * matching what both native SDKs do.
 */
export function integrityFailure(warnings: MetadataWarning[] | undefined): string | null {
	const failed = warnings?.some((w) => w.code === CredentialParsingError.IntegrityFail);
	if (!failed) return null;
	return "The issuer's type metadata does not match what it published";
}
