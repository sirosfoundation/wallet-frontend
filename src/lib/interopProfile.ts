import type { DidKeyVersion } from '@/config';

/**
 * Which interoperability profile the wallet presents itself as, when nothing else decides.
 *
 * The two profiles differ in how the Holder's key is bound to a credential:
 *
 * - `haip` binds the raw key. The OID4VCI proof embeds it as a `jwk` header and the credential
 *   carries it as `cnf.jwk`. This is what every SIROS issuer accepts today.
 * - `diip` names the key instead. The Holder is identified by a `did:jwk`, the proof carries
 *   that DID as `iss` with a `kid` into its DID document, and the credential binds by `cnf.kid`.
 *
 * `haip` is the default deliberately: adding DIIP support should not change the proof shape
 * existing issuers already accept, so a deployment targeting a DIIP ecosystem opts in.
 */
export type InteropProfile = 'haip' | 'diip';

export const DEFAULT_INTEROP_PROFILE: InteropProfile = 'haip';

export function isInteropProfile(value: unknown): value is InteropProfile {
	return value === 'haip' || value === 'diip';
}

/**
 * The `cryptographic_binding_methods_supported` value that means "a did:jwk Holder identifier",
 * as published on a credential configuration (OID4VCI 1.0 §12.2.3.2).
 */
const DID_JWK_BINDING = 'did:jwk';

/**
 * The binding method for a raw key. An issuer advertising this accepts the embedded-key proof
 * HAIP uses.
 */
const JWK_BINDING = 'jwk';

/**
 * Decide how to identify Holder keys for one credential configuration.
 *
 * Precedence, widest to narrowest:
 *
 * 1. What the Issuer advertises. An issuer publishing `cryptographic_binding_methods_supported`
 *    has said what it accepts, and that beats any local preference — it is what stops two
 *    wallets configured differently from disagreeing against the same issuer, and what means
 *    nobody has to know which profile an issuer they just scanned belongs to.
 * 2. The configured profile, for an issuer that publishes nothing.
 *
 * `configuredDidKeyVersion` selects which `did:key` flavour a HAIP wallet mints, and is ignored
 * under DIIP, where the profile requires `did:jwk` specifically.
 *
 * NOTE: nothing feeds `advertisedBindingMethods` yet. The engine builds the Credential Request
 * for every transport in use and its sign request carries `proof_types_supported` but not
 * `cryptographic_binding_methods_supported`, so the negotiation below is currently unreachable
 * from the wallet and the configured profile decides every flow. Threading that field through
 * needs a go-wallet-backend change, the same shape of gap `authorization_details` had.
 */
export function resolveDidKeyVersion({
	profile,
	configuredDidKeyVersion,
	advertisedBindingMethods,
}: {
	profile: InteropProfile;
	configuredDidKeyVersion?: DidKeyVersion;
	advertisedBindingMethods?: string[];
}): DidKeyVersion | undefined {
	const forProfile = (p: InteropProfile): DidKeyVersion | undefined =>
		p === 'diip' ? 'jwk' : configuredDidKeyVersion;

	if (advertisedBindingMethods && advertisedBindingMethods.length > 0) {
		// Prefer the Holder identifier the issuer names. When it accepts both, the configured
		// profile breaks the tie rather than the order the issuer happened to list them in.
		const acceptsDidJwk = advertisedBindingMethods.includes(DID_JWK_BINDING);
		const acceptsJwk = advertisedBindingMethods.includes(JWK_BINDING);
		if (acceptsDidJwk && !acceptsJwk) {
			return 'jwk';
		}
		if (acceptsJwk && !acceptsDidJwk) {
			return configuredDidKeyVersion;
		}
		if (acceptsDidJwk && acceptsJwk) {
			return forProfile(profile);
		}
		// Only methods this wallet cannot produce (`cose_key`, `did:web`, …). Fall through to
		// the profile and let the issuer reject it, rather than silently picking something it
		// did not offer.
	}

	return forProfile(profile);
}
