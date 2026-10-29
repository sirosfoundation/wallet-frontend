/**
 * Error codes that can be returned by the AuthZEN proxy.
 */
export enum AuthZENErrorCode {
	/** Request was malformed or missing required fields */
	INVALID_REQUEST = 'invalid_request',

	/** Authentication failed (invalid/missing JWT) */
	UNAUTHORIZED = 'unauthorized',

	/** Query was not authorized by policy */
	FORBIDDEN = 'forbidden',

	/** Trust evaluation is not configured */
	NOT_CONFIGURED = 'not_configured',

	/** PDP request failed */
	PDP_ERROR = 'pdp_error',

	/** Network or timeout error */
	NETWORK_ERROR = 'network_error',
}

/**
 * Trust status for display purposes.
 */
export enum TrustStatus {
	/** Entity is trusted per policy */
	TRUSTED = 'trusted',

	/** Entity is not trusted */
	UNTRUSTED = 'untrusted',

	/** Trust evaluation is pending/in-progress */
	PENDING = 'pending',

	/** Trust could not be evaluated (error) */
	UNKNOWN = 'unknown',
}
