/**
 * OID4VCI (Credential Issuance) flow types for transport abstraction
 */

import type { 
  CredentialConfigurationSupported, 
  OpenidCredentialIssuerMetadata 
} from 'wallet-common';

/**
 * Parameters for starting or continuing an OID4VCI flow
 */
export interface OID4VCIFlowParams {
  // ===== Entry points (one of these starts the flow) =====
  
  /** Credential offer URI (e.g., openid-credential-offer://...) */
  credentialOfferUri?: string;
  
  /** JSON-encoded credential offer (alternative to URI) */
  credentialOffer?: string;

  // ===== Continuation parameters =====
  
  /** Holder binding information (sent after user consent) */
  holderBinding?: OID4VCIHolderBinding;
  
  /** Selected credential configuration ID */
  credentialConfigurationId?: string;
  
  // ===== Authorization code flow =====
  
  /** Authorization code (after redirect from authorization server) */
  authorizationCode?: string;
  
  /** PKCE code verifier */
  codeVerifier?: string;
  
  // ===== Pre-authorized code flow =====
  
  /** Pre-authorized code from credential offer */
  preAuthorizedCode?: string;
  
  /** Transaction code input (PIN) if required */
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
  
  /** Available credential configurations */
  credentialConfigurations?: Record<string, CredentialConfigurationSupported>;
  
  /** Selected credential configuration ID */
  selectedCredentialConfigurationId?: string;
  
  // ===== Authorization =====
  
  /** Whether user authorization is required */
  authorizationRequired?: boolean;
  
  /** URL to redirect user for authorization */
  authorizationUrl?: string;
  
  /** Issuer state (for authorization flow) */
  issuerState?: string;
  
  // ===== Pre-authorized flow =====
  
  /** Pre-authorized code */
  preAuthorizedCode?: string;
  
  /** Transaction code requirements */
  txCode?: OID4VCITxCode;
  
  // ===== Credential (when flow completes) =====
  
  /** Issued credential (raw string) */
  credential?: string;
  
  /** Credential format */
  format?: string;
  
  // ===== Deferred issuance =====
  
  /** Transaction ID for deferred credential polling */
  transactionId?: string;
  
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
 * Credential issuer information for display
 */
export interface OID4VCIIssuerInfo {
  /** Issuer identifier (URL) */
  identifier: string;
  /** Display name */
  name?: string;
  /** Logo URL */
  logo?: string;
}
