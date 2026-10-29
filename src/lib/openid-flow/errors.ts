
type OIDFlowErrorParams = {
	code: string;
	message: string;
	/** Structured details, e.g. `missing_types` or the engine's `redirect_uri`. */
	details?: Record<string, unknown>;
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
	public readonly details?: Record<string, unknown>;
	constructor({
		code,
		message,
		details,
	}: OIDFlowErrorParams) {
		super(message);
		this.code = code;
		this.details = details;
		this.name = 'OIDFlowError';
	}
}
