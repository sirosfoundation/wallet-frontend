/**
 * OID4VP (Verifiable Presentation) flow types for transport abstraction
 */

import type { DcqlQuery } from 'dcql';
import type { TrustEvaluation } from './TrustTypes';

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
