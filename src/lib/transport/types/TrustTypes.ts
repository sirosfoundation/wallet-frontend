/**
 * Shared trust evaluation types used across OID4VCI and OID4VP flows.
 *
 * Trust evaluation is performed server-side by the wallet backend, which
 * delegates to an AuthZEN PDP (Policy Decision Point). The frontend never
 * performs its own trust evaluation — it displays the result provided by
 * the backend.
 *
 * The tri-state `TrustStatus` distinguishes:
 * - `'trusted'`   — PDP evaluated and approved the entity
 * - `'untrusted'` — PDP evaluated and rejected the entity
 * - `'unknown'`   — No PDP configured, PDP unreachable, or evaluation error
 */

/**
 * Trust evaluation status from the backend PDP.
 */
export type TrustStatus = 'trusted' | 'unknown' | 'untrusted';

/**
 * Trust evaluation result attached to issuer/verifier info.
 *
 * These fields are populated by the backend and made available for UI rendering.
 * The presentation layer can use them to display trust indicators (shields,
 * badges, warnings) at the designer's discretion.
 */
export interface TrustEvaluation {
	/** Tri-state trust status from backend evaluation */
	trustedStatus?: TrustStatus;

	/** Human-readable reason for the trust decision (from PDP) */
	reason?: string;

	/**
	 * Auxiliary metadata from the PDP evaluation.
	 *
	 * May contain trust chain details, DID document fragments, ETSI TSL
	 * service information, or other PDP-specific context. Structure depends
	 * on the PDP implementation; treat as opaque display data.
	 */
	metadata?: Record<string, unknown>;
}
