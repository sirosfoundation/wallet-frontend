/**
 * Protocol Step Type Definitions
 *
 * Explicit type definitions for OID4VCI and OID4VP protocol flow stages.
 * Provides type-safe step tracking with metadata for UI rendering.
 */

// ============================================================================
// OID4VCI Protocol Steps
// ============================================================================

/**
 * OID4VCI protocol flow steps - represents stages in credential issuance
 */
export type OID4VCIStep =
  | 'idle'
  | 'parsing_offer'
  | 'fetching_issuer_metadata'
  | 'awaiting_tx_code'
  | 'requesting_authorization'
  | 'awaiting_authorization_response'
  | 'exchanging_token'
  | 'requesting_credential'
  | 'storing_credential'
  | 'completed'
  | 'error';

/**
 * Metadata for each OID4VCI step
 */
export interface OID4VCIStepInfo {
  /** Human-readable message for UI display */
  message: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether this is a terminal state */
  isTerminal: boolean;
  /** Whether this step requires user input */
  requiresUserInput: boolean;
}

/**
 * Step metadata lookup for OID4VCI
 */
export const OID4VCI_STEP_INFO: Record<OID4VCIStep, OID4VCIStepInfo> = {
  idle: {
    message: 'Ready',
    progress: 0,
    isTerminal: false,
    requiresUserInput: false,
  },
  parsing_offer: {
    message: 'Parsing credential offer...',
    progress: 10,
    isTerminal: false,
    requiresUserInput: false,
  },
  fetching_issuer_metadata: {
    message: 'Fetching issuer metadata...',
    progress: 20,
    isTerminal: false,
    requiresUserInput: false,
  },
  awaiting_tx_code: {
    message: 'Waiting for transaction code...',
    progress: 30,
    isTerminal: false,
    requiresUserInput: true,
  },
  requesting_authorization: {
    message: 'Requesting authorization...',
    progress: 40,
    isTerminal: false,
    requiresUserInput: false,
  },
  awaiting_authorization_response: {
    message: 'Waiting for authorization...',
    progress: 50,
    isTerminal: false,
    requiresUserInput: true,
  },
  exchanging_token: {
    message: 'Exchanging token...',
    progress: 60,
    isTerminal: false,
    requiresUserInput: false,
  },
  requesting_credential: {
    message: 'Requesting credential...',
    progress: 75,
    isTerminal: false,
    requiresUserInput: false,
  },
  storing_credential: {
    message: 'Storing credential...',
    progress: 90,
    isTerminal: false,
    requiresUserInput: false,
  },
  completed: {
    message: 'Credential received successfully',
    progress: 100,
    isTerminal: true,
    requiresUserInput: false,
  },
  error: {
    message: 'An error occurred',
    progress: 0,
    isTerminal: true,
    requiresUserInput: false,
  },
};

// ============================================================================
// OID4VP Protocol Steps
// ============================================================================

/**
 * OID4VP protocol flow steps - represents stages in credential presentation
 */
export type OID4VPStep =
  | 'idle'
  | 'parsing_request'
  | 'fetching_verifier_metadata'
  | 'matching_credentials'
  | 'awaiting_credential_selection'
  | 'awaiting_consent'
  | 'creating_presentation'
  | 'sending_response'
  | 'completed'
  | 'error';

/**
 * Metadata for each OID4VP step
 */
export interface OID4VPStepInfo {
  /** Human-readable message for UI display */
  message: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether this is a terminal state */
  isTerminal: boolean;
  /** Whether this step requires user input */
  requiresUserInput: boolean;
}

/**
 * Step metadata lookup for OID4VP
 */
export const OID4VP_STEP_INFO: Record<OID4VPStep, OID4VPStepInfo> = {
  idle: {
    message: 'Ready',
    progress: 0,
    isTerminal: false,
    requiresUserInput: false,
  },
  parsing_request: {
    message: 'Parsing authorization request...',
    progress: 10,
    isTerminal: false,
    requiresUserInput: false,
  },
  fetching_verifier_metadata: {
    message: 'Fetching verifier metadata...',
    progress: 20,
    isTerminal: false,
    requiresUserInput: false,
  },
  matching_credentials: {
    message: 'Finding matching credentials...',
    progress: 35,
    isTerminal: false,
    requiresUserInput: false,
  },
  awaiting_credential_selection: {
    message: 'Select credentials to present...',
    progress: 45,
    isTerminal: false,
    requiresUserInput: true,
  },
  awaiting_consent: {
    message: 'Confirm credential sharing...',
    progress: 55,
    isTerminal: false,
    requiresUserInput: true,
  },
  creating_presentation: {
    message: 'Creating presentation...',
    progress: 70,
    isTerminal: false,
    requiresUserInput: false,
  },
  sending_response: {
    message: 'Sending response...',
    progress: 85,
    isTerminal: false,
    requiresUserInput: false,
  },
  completed: {
    message: 'Presentation sent successfully',
    progress: 100,
    isTerminal: true,
    requiresUserInput: false,
  },
  error: {
    message: 'An error occurred',
    progress: 0,
    isTerminal: true,
    requiresUserInput: false,
  },
};

// ============================================================================
// Unified Protocol Step Type
// ============================================================================

/**
 * Union type for any protocol step
 */
export type ProtocolStep = OID4VCIStep | OID4VPStep;

/**
 * Protocol type discriminator
 */
export type ProtocolType = 'oid4vci' | 'oid4vp';

/**
 * Current protocol state with type discrimination
 */
export type ProtocolState =
  | { type: 'oid4vci'; step: OID4VCIStep; error?: string }
  | { type: 'oid4vp'; step: OID4VPStep; error?: string };

/**
 * Get step info for a protocol state
 */
export function getStepInfo(state: ProtocolState): OID4VCIStepInfo | OID4VPStepInfo {
  if (state.type === 'oid4vci') {
    return OID4VCI_STEP_INFO[state.step];
  }
  return OID4VP_STEP_INFO[state.step];
}

/**
 * Check if current state requires user input
 */
export function requiresUserInput(state: ProtocolState): boolean {
  return getStepInfo(state).requiresUserInput;
}

/**
 * Check if current state is terminal (completed or error)
 */
export function isTerminalState(state: ProtocolState): boolean {
  return getStepInfo(state).isTerminal;
}
