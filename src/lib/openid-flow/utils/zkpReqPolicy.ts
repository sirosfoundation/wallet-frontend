import type { OID4VPVerifiedRequest } from '../types/OID4VPTypes';

/** The DCQL credential `format` of a zero-knowledge (`zkp_req`) presentation request. */
export const ZKP_REQ_FORMAT = 'zkp_req';

/** Error code of a result or flow error produced because a `zkp_req` request was refused. */
export const ZKP_REQ_REFUSED = 'ZKP_REQ_REFUSED';

/** What is known about the response encryption at the point a request is checked. */
export type ResponseEncryptionState =
	/** `response_encryption` came with the sign request. */
	| 'present'
	/** The sign request carried none. */
	| 'absent'
	/** Before the sign request (credential selection, matching): only the response mode is known. */
	| 'not-yet-known';

/** Whether a DCQL query asks for a `zkp_req` presentation (any credential query with that format). */
export function requestsZkpReq(dcqlQuery: unknown): boolean {
	const credentials = (dcqlQuery as { credentials?: unknown } | null | undefined)?.credentials;
	return (
		Array.isArray(credentials) &&
		credentials.some((credential) => !!credential && typeof credential === 'object' && (credential as { format?: unknown }).format === ZKP_REQ_FORMAT)
	);
}

/**
 * The wallet's policy for a `zkp_req` presentation (the engine does not apply it): the request
 * must be a signed request object whose signature the engine verified, and the response must be
 * encrypted (`direct_post.jwt`, with a `response_encryption` key at the sign step). Otherwise the
 * wallet refuses before it matches, selects or signs anything.
 *
 * Returns the reason for the refusal, or `null` when the request may proceed. A missing
 * `verified_request` reads as not signed, so the policy fails closed.
 */
export function zkpReqRefusal(
	verifiedRequest: OID4VPVerifiedRequest | undefined,
	responseEncryption: ResponseEncryptionState,
): string | null {
	if (verifiedRequest?.signed !== true || verifiedRequest.signatureVerification !== 'verified') {
		return 'A zkp_req presentation requires a signed request object';
	}
	if (verifiedRequest.responseMode !== 'direct_post.jwt' || responseEncryption === 'absent') {
		return 'A zkp_req presentation requires the response to be encrypted (direct_post.jwt)';
	}
	return null;
}
