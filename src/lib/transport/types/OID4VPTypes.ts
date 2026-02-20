/**
 * OID4VP (Verifiable Presentation) flow types for transport abstraction
 */

// Note: These types are defined locally to avoid coupling to wallet-common exports
// which may vary between versions. The transport layer handles conversion.

/**
 * Parameters for starting or continuing an OID4VP flow
 */
export interface OID4VPFlowParams {
  // ===== Entry point =====
  
  /** Authorization request URI */
  authorizationRequestUri?: string;
  
  // ===== Continuation parameters (after credential selection) =====
  
  /** Selected credentials for presentation */
  selectedCredentials?: OID4VPSelectedCredential[];
}

/**
 * A credential selected for presentation
 */
export interface OID4VPSelectedCredential {
  /** Input descriptor ID from presentation definition */
  descriptorId: string;
  /** Raw credential string */
  credentialRaw: string;
  /** Key ID for holder binding */
  holderKeyKid: string;
  /** Disclosure selection for SD-JWT (claim paths to disclose) */
  disclosureSelection?: string[];
}

/**
 * Result of an OID4VP flow operation
 */
export interface OID4VPFlowResult {
  /** Whether this step succeeded */
  success: boolean;
  
  // ===== Presentation request (for consent UI) =====
  
  /** Presentation definition from verifier (generic type for transport layer) */
  presentationDefinition?: unknown;
  
  /** Map of descriptor ID to matching credentials */
  conformantCredentials?: Map<string, unknown[]>;
  
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
 * Verifier information for display
 */
export interface OID4VPVerifierInfo {
  /** Verifier display name */
  name?: string;
  /** Purpose of the verification request */
  purpose?: string;
  /** Trust status from registry */
  trustedStatus?: 'trusted' | 'unknown' | 'untrusted';
  /** Domain name of the verifier */
  domain?: string;
  /** Logo URL */
  logo?: string;
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
