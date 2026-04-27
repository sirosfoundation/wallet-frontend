
type OIDFlowErrorParams = {
	code: string;
	message: string;
};
/**
 * Errors during OpenID VCI and VP flows.
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
