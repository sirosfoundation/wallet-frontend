/**
 * OID4VCI (Credential Issuance) flow types for transport abstraction
 */

import type {
	CredentialConfigurationSupported,
	OpenidCredentialIssuerMetadata
} from 'wallet-common';
import type { TrustEvaluation } from './TrustTypes';

/**
 * Parameters for starting or continuing an OID4VCI flow
 */
export interface OID4VCIFlowParams {
	// ===== Entry points (one of these starts the flow) =====

	/** Credential offer URI (e.g., openid-credential-offer://...) */
	credentialOfferUri?: string;

	/** JSON-encoded credential offer (alternative to URI) */
	credentialOffer?: string;

	/** OAuth redirect URI for authorization code flow */
	redirectUri?: string;

	// ===== Continuation parameters =====

	/** Holder binding information (sent after user consent) */
	holderBinding?: OID4VCIHolderBinding;

	/** Selected credential configuration ID */
	credentialConfigurationId?: string;

	// ===== Authorization code flow =====

	/** Authorization code (after redirect from authorization server) */
	authorizationCode?: string;

	/** OAuth state parameter (for correlation) */
	state?: string;

	/** PKCE code verifier */
	codeVerifier?: string;

	// ===== Resumption context (for same-tab redirect flow) =====

	/** Issuer identifier for resumption */
	issuerIdentifier?: string;

	/** Credential configuration ID for resumption */
	configurationId?: string;

	// ===== Pre-authorized code flow =====

	/** Pre-authorized code (for pre-auth grant type) */
	preAuthorizedCode?: string;

	/** Transaction code input (user-provided PIN for pre-auth flow) */
	txCodeInput?: string;
}

/**
 * Holder binding information for credential issuance
 */
export interface OID4VCIHolderBinding {
	/** Binding method */
	method: 'dpop' | 'attestation' | 'jwt_key';
	/** Public key in JWK format */
	publicKeyJwk: JsonWebKey;
}

/**
 * Result of an OID4VCI flow operation
 */
export interface OID4VCIFlowResult {
	/** Whether this step succeeded */
	success: boolean;

	// ===== Metadata (for consent UI) =====

	/** Issuer metadata */
	issuerMetadata?: OpenidCredentialIssuerMetadata;

	/** Issuer information including trust evaluation result */
	issuerInfo?: OID4VCIIssuerInfo;

	/** Credential issuer identifier (URL) — always populated when credentials are returned */
	credentialIssuerIdentifier?: string;

	/** Available credential configurations */
	credentialConfigurations?: Record<string, CredentialConfigurationSupported>;

	/** Selected credential configuration ID */
	selectedCredentialConfigurationId?: string;

	// ===== Authorization =====

	/** Whether user authorization is required */
	authorizationRequired?: boolean;

	/** URL to redirect user for authorization */
	authorizationUrl?: string;

	/** PKCE code verifier (needed for token exchange) */
	codeVerifier?: string;

	/** Issuer state (for authorization flow) */
	issuerState?: string;

	// ===== Pre-authorized flow =====

	/** Pre-authorized code */
	preAuthorizedCode?: string;

	/** Transaction code requirements */
	txCode?: OID4VCITxCode;

	// ===== Credential (when flow completes) =====

	/** Issued credential (raw string) @deprecated */
	credential?: string; //TODO: remove, should always return credentials array.

	/** Credential format @deprecated */
	format?: string; //TODO: remove, should always return credentials array.

	/** Multiple issued credentials (batch issuance) */
	credentials?: Array<{
		format?: string;
		credential: string;
		vct?: string;
	}>;

	// ===== Deferred issuance =====

	/** Transaction ID for deferred credential polling */
	transactionId?: string;

	// ===== Flow resumption (same-tab redirect) =====

	/** Parsed credential offer (for storage and resumption after redirect) */
	credentialOffer?: OID4VCICredentialOffer;

	// ===== Error =====

	/** Error information if success is false */
	error?: {
		code: string;
		message: string;
	};
}

/**
 * Transaction code requirements for pre-authorized flows
 */
export interface OID4VCITxCode {
	/** Input mode (numeric, text, etc.) */
	inputMode?: string;
	/** Expected length of the code */
	length?: number;
	/** Description to show the user */
	description?: string;
}

/**
 * Credential issuer information for display.
 *
 * Extends TrustEvaluation for trust fields (`trustedStatus`, `reason`, `metadata`)
 * which are populated by the backend after PDP evaluation and made available
 * for UI designers to render trust indicators (shields, badges, warnings, etc.).
 */
export interface OID4VCIIssuerInfo extends TrustEvaluation {
	/** Issuer identifier (URL). Optional — omitted if backend doesn't provide a valid identifier. */
	identifier?: string;
	/** Display name */
	name?: string;
	/** Logo URL */
	logo?: string;
}

/**
 * Credential offer structure (OID4VCI spec).
 * Used for storing and resuming authorization code flows after redirect.
 */
export interface OID4VCICredentialOffer {
	/** Credential issuer URL */
	credential_issuer: string;
	/** List of credential configuration IDs being offered */
	credential_configuration_ids: string[];
	/** Grant types (authorization_code, pre-authorized_code) */
	grants?: Record<string, unknown>;
}
