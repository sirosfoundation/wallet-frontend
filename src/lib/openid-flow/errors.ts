
type OIDFlowErrorParams = {
	code: string;
	message: string;
	/**
	 * Structured details the engine attached to a `flow_error` (see
	 * go-wallet-backend `FlowError.details`), e.g. `requested_types` on
	 * `NO_MATCHING_CREDENTIAL`. Carried through so the UI can say *which*
	 * credential is missing instead of only that something is.
	 */
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
