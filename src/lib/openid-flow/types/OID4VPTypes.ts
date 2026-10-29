/**
 * OID4VP (Verifiable Presentation) flow types for transport abstraction
 */

import type { DcqlQuery } from 'dcql';
import type { TrustEvaluation } from './TrustTypes';
import { TrustStatus } from 'wallet-common';

// Note: These types are defined locally to avoid coupling to wallet-common exports
// which may vary between versions. The transport layer handles conversion.

/**
 * Parameters for starting or continuing an OID4VP flow
 */
export interface OID4VPFlowParams {
	// ===== Entry point =====

	/** Authorization request URI */
	requestUriRef?: string;
	clientId?: string;

	// ===== Continuation parameters (after credential selection) =====

	/** Selected credentials for presentation */
	selectedCredentials?: OID4VPSelectedCredential[];
}

/**
 * A credential selected for presentation
 */
export interface OID4VPSelectedCredential {
	/** Batch ID of the credential */
	batchId: number;
	/** DCQL credential query ID (e.g. "pid_1_5") */
	credentialQueryId: string;
	/** per-instance credentialId as string (opaque to backend) */
	walletCredentialRef: string;
	/** raw SD-JWT — cached locally AND sent to backend */
	credentialRaw: string;
	/** kid for holder binding */
	holderKeyKid: string;
	/** claims to disclose (was: disclosureSelection) */
	disclosedClaims?: string[];
}

/**
 * Result of an OID4VP flow operation
 */
/**
 * The OpenID4VP request as the engine validated it (`verified_request` in the engine's
 * websocket protocol, "Verified request inputs"). It carries no trust verdict. The wallet
 * applies its own policy over these members; unknown members are ignored.
 */
export interface OID4VPVerifiedRequest {
	/** The request's own `client_id`, after the engine's client_id match and scheme-prefix checks. */
	clientId?: string;
	/** `x509_san_dns`, `x509_san_uri`, `x509_hash`, `did`, `verifier_attestation`, `redirect_uri`, ... */
	clientIdScheme?: string;
	/** `direct_post`, `direct_post.jwt`, `query` or `fragment`. */
	responseMode?: string;
	/** The validated `response_uri` (the `redirect_uri` when the request has no `response_uri`). */
	responseUri?: string;
	/** `true` only when `signatureVerification` is `verified`; absent reads as not signed. */
	signed?: boolean;
	/** What the engine itself established about the request object's signature. */
	signatureVerification?: 'verified' | 'deferred' | 'none';
	/** The verifier's `client_metadata`, verbatim. */
	clientMetadata?: Record<string, unknown>;
}

export interface OID4VPFlowResult {
	/** Whether this step succeeded */
	success: boolean;

	// ===== Credential selection (for consent UI) =====

	/** DCQL query from verifier */
	dcqlQuery?: DcqlQuery.Input;

	selectedCredentials?: OID4VPSelectedCredential[];

	// ===== Presentation request (for consent UI) =====

	/** Presentation definition from verifier (generic type for transport layer) */
	presentationDefinition?: unknown;

	/** Map of descriptor ID to matching credentials */
	conformantCredentials?: Map<string, {
	credentials: number[];
	requestedFields: Array<{ name?: string; purpose?: string; path?: (string | null)[] }>
}>;

	/** Verifier information */
	verifierInfo?: OID4VPVerifierInfo;

	/** The validated request as the engine sent it with the credential selection (data only; no policy here). */
	verifiedRequest?: OID4VPVerifiedRequest;

	/** Transaction data requiring explicit consent */
	transactionData?: OID4VPTransactionData[];

	// ===== After submission =====

	/** Redirect URI (for same-device flow) */
	redirectUri?: string;

	/** Response for cross-device flow */
	responseData?: unknown;

	// ===== Error =====

	/** Error information if success is false */
	error?: {
		code: string;
		message: string;
		/** Structured details, e.g. `missing_types` or the engine's `redirect_uri`. */
		details?: Record<string, unknown>;
	};
}

/**
 * Verifier information for display.
 *
 * Extends TrustEvaluation for trust fields (`trustedStatus`, `reason`, `metadata`)
 * which are populated by the backend after PDP evaluation and made available
 * for UI designers to render trust indicators (shields, badges, warnings, etc.).
 */
export interface OID4VPVerifierInfo extends TrustEvaluation {
	/** Verifier display name */
	name?: string;
	/** Purpose of the verification request */
	purpose?: string;
	/** Domain name of the verifier */
	domain?: string;
	/** Logo URL */
	logo?: string;
	/** Client ID scheme (e.g., 'x509_san_dns', 'redirect_uri', etc.) */
	clientIdScheme?: string;
	/** Trust framework identifier */
	trustFramework?: string;
	/** Trust evaluation status */
	trustStatus?: TrustStatus;
	/** Whether the verifier is trusted */
	trusted?: boolean;
}

/**
 * Transaction data that requires explicit user consent
 */
export interface OID4VPTransactionData {
	/** Type of transaction data */
	type: string;
	/** Human-readable description */
	description: string;
	/** Raw transaction data */
	data: unknown;
}

/**
 * Response mode for OID4VP flows
 */
export type OID4VPResponseMode =
	| 'direct_post'
	| 'direct_post.jwt'
	| 'fragment'
	| 'query';
