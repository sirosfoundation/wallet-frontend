/**
 * Protocol Step Type Definitions
 *
 * Explicit type definitions for OID4VCI and OID4VP protocol flow stages.
 * Provides type-safe step tracking with metadata for UI rendering.
 *
 * Runtime constants and helper functions are in ../protocolStepInfo.ts
 */

import { getStepInfo } from '../protocolStepInfo';

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
	/** i18n key for step message (use with t() function) */
	messageKey: string;
	/** Progress percentage (0-100) */
	progress: number;
	/** Whether this is a terminal state */
	isTerminal: boolean;
	/** Whether this step requires user input */
	requiresUserInput: boolean;
}

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
	/** i18n key for step message (use with t() function) */
	messageKey: string;
	/** Progress percentage (0-100) */
	progress: number;
	/** Whether this is a terminal state */
	isTerminal: boolean;
	/** Whether this step requires user input */
	requiresUserInput: boolean;
}

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

// Re-export runtime constants and helpers for backwards compatibility
export {
	OID4VCI_STEP_INFO,
	OID4VP_STEP_INFO,
	getStepInfo,
	requiresUserInput,
} from '../protocolStepInfo';

/**
 * Check if current state is terminal (completed or error)
 */
export function isTerminalState(state: ProtocolState): boolean {
	return getStepInfo(state).isTerminal;
}
