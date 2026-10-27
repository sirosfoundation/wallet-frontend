
type OIDFlowErrorParams = {
	code: string;
	message: string;
};
/**
 * Errors during OpenID VCI and VP flows.
 *
 * @todo Make sure this naming does not clash with any existing types in codebase.
 * @todo Consider using this as base class for more specific error types (e.g. OID4VCIError, OID4VPError) if needed.
 * @todo Ensure this is well implemented with consistent usage in both transports and flow hooks.
 */
export class OIDFlowError extends Error {
	public readonly code: string;
	constructor({
		code,
		message,
	}: OIDFlowErrorParams) {
		super(message);
		this.code = code;
		this.name = 'OIDFlowError';
	}
}

/**
 * Failure of the wallet's own response encryption (client-held key, decryption, or building a
 * `direct_post.jwt` response). The message never carries keys, JWE text, credentials or seeds.
 */
export class ClientHeldEncryptionError extends Error {
	constructor(message: string, readonly code: string = 'CLIENT_HELD_ENCRYPTION_ERROR') {
		super(message);
		this.name = 'ClientHeldEncryptionError';
	}
}

/**
 * Error code of a credential response refused because it carries a superseded secret-bearing member
 * (org.siros.secret_seed, org.siros.holder_commitments, org.siros.psc, holder_commitments,
 * secret_members); same name as the Kotlin and Swift SDKs and the engine.
 */
export const LEGACY_SECRET_MEMBER = 'LEGACY_SECRET_MEMBER';
