/**
 * OID4VCI `authorization_details` construction.
 *
 * DIIP v5 requires a Wallet to support both ways of asking an Issuer for a specific credential
 * type: `authorization_details` carrying a `credential_configuration_id` (OID4VCI 1.0 §5.1.1),
 * and the `scope` parameter. `authorization_details` is the structured form and the one Issuer
 * Agents must support, so the wallet sends it whenever it knows which configuration it wants.
 *
 * This lives apart from any transport on purpose. The wallet no longer builds the Authorization
 * Request itself — the engine does, for every transport in use — so the *decision* stays here,
 * where DIIP puts it, and each transport only forwards the result in its own wire format. That
 * is the same split `clientAttestation` already uses, and the same one wallet-frontend#301 used
 * for OID4VP's `request_uri_method`.
 */

/**
 * One `openid_credential` authorization detail. Only the `credential_configuration_id` form is
 * produced: DIIP v5 requires that one, and the `format`-based alternative is what it replaces.
 */
export type OID4VCIAuthorizationDetail = {
	type: 'openid_credential';
	credential_configuration_id: string;
};

/**
 * Authorization Server metadata, narrowed to the field that decides this.
 */
export type AuthorizationDetailsCapability = {
	authorization_details_types_supported?: string[];
};

/**
 * Build the `authorization_details` for one credential configuration, or `null` when the wallet
 * should not send any.
 *
 * `asMetadata` is optional because the wallet does not always hold it: on the engine-driven
 * transports the Authorization Server is discovered server-side. When it is absent the details
 * are built anyway and the engine, which does have the metadata, decides whether to use them —
 * sending intent the Issuer may ignore is safe, whereas withholding it would fail the
 * requirement outright. When it is present, an Authorization Server that advertises its
 * supported types *without* `openid_credential` is taken at its word.
 */
export function buildAuthorizationDetails(
	credentialConfigurationId: string | undefined | null,
	asMetadata?: AuthorizationDetailsCapability | null,
): OID4VCIAuthorizationDetail[] | null {
	if (!credentialConfigurationId) {
		return null;
	}

	const supportedTypes = asMetadata?.authorization_details_types_supported;
	if (supportedTypes && !supportedTypes.includes('openid_credential')) {
		return null;
	}

	return [{
		type: 'openid_credential',
		credential_configuration_id: credentialConfigurationId,
	}];
}
