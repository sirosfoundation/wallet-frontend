/**
 * `wallet_metadata` for OpenID4VP 1.0 §5.10's `request_uri_method=post`:
 * what this wallet tells a verifier it can present, so the verifier can
 * tailor the Request Object it returns.
 *
 * It belongs on this side of the connection. The backend engine never sees a
 * credential and never builds a VP token - matching and signing both happen
 * here - so left alone it sends a guess of its own. This replaces that guess
 * with what the wallet frontend actually implements: SD-JWT VC under both the
 * current (`dc+sd-jwt`) and the legacy (`vc+sd-jwt`) identifier, and ISO mdoc.
 * ES256 throughout - every holder key here is a P-256 key held in
 * passkey-PRF-encrypted storage.
 *
 * Kept to `vp_formats_supported`: it is the part a verifier acts on, and
 * every further field would be a claim about this wallet that nothing here
 * checks.
 */
export const WALLET_METADATA: Record<string, unknown> = {
	vp_formats_supported: {
		'dc+sd-jwt': {
			'sd-jwt_alg_values': ['ES256'],
			'kb-jwt_alg_values': ['ES256'],
		},
		'vc+sd-jwt': {
			'sd-jwt_alg_values': ['ES256'],
			'kb-jwt_alg_values': ['ES256'],
		},
		mso_mdoc: {
			alg_values: ['ES256'],
		},
	},
};
