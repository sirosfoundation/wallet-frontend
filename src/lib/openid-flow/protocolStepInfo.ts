/**
 * Protocol Step Runtime Constants and Helpers
 *
 * Runtime data and utility functions for protocol step tracking.
 * Separated from type definitions to keep types files pure.
 */

import type {
	OID4VCIStep,
	OID4VCIStepInfo,
	OID4VPStep,
	OID4VPStepInfo,
	ProtocolState,
} from './types/ProtocolSteps';

/**
 * Step metadata lookup for OID4VCI
 */
export const OID4VCI_STEP_INFO: Record<OID4VCIStep, OID4VCIStepInfo> = {
	idle: {
		messageKey: 'protocolSteps.oid4vci.idle',
		progress: 0,
		isTerminal: false,
		requiresUserInput: false,
	},
	parsing_offer: {
		messageKey: 'protocolSteps.oid4vci.parsingOffer',
		progress: 10,
		isTerminal: false,
		requiresUserInput: false,
	},
	fetching_issuer_metadata: {
		messageKey: 'protocolSteps.oid4vci.fetchingIssuerMetadata',
		progress: 20,
		isTerminal: false,
		requiresUserInput: false,
	},
	awaiting_tx_code: {
		messageKey: 'protocolSteps.oid4vci.awaitingTxCode',
		progress: 30,
		isTerminal: false,
		requiresUserInput: true,
	},
	requesting_authorization: {
		messageKey: 'protocolSteps.oid4vci.requestingAuthorization',
		progress: 40,
		isTerminal: false,
		requiresUserInput: false,
	},
	awaiting_authorization_response: {
		messageKey: 'protocolSteps.oid4vci.awaitingAuthorizationResponse',
		progress: 50,
		isTerminal: false,
		requiresUserInput: true,
	},
	exchanging_token: {
		messageKey: 'protocolSteps.oid4vci.exchangingToken',
		progress: 60,
		isTerminal: false,
		requiresUserInput: false,
	},
	requesting_credential: {
		messageKey: 'protocolSteps.oid4vci.requestingCredential',
		progress: 75,
		isTerminal: false,
		requiresUserInput: false,
	},
	storing_credential: {
		messageKey: 'protocolSteps.oid4vci.storingCredential',
		progress: 90,
		isTerminal: false,
		requiresUserInput: false,
	},
	completed: {
		messageKey: 'protocolSteps.oid4vci.completed',
		progress: 100,
		isTerminal: true,
		requiresUserInput: false,
	},
	error: {
		messageKey: 'protocolSteps.common.error',
		progress: 0,
		isTerminal: true,
		requiresUserInput: false,
	},
};

/**
 * Step metadata lookup for OID4VP
 */
export const OID4VP_STEP_INFO: Record<OID4VPStep, OID4VPStepInfo> = {
	idle: {
		messageKey: 'protocolSteps.oid4vp.idle',
		progress: 0,
		isTerminal: false,
		requiresUserInput: false,
	},
	parsing_request: {
		messageKey: 'protocolSteps.oid4vp.parsingRequest',
		progress: 10,
		isTerminal: false,
		requiresUserInput: false,
	},
	fetching_verifier_metadata: {
		messageKey: 'protocolSteps.oid4vp.fetchingVerifierMetadata',
		progress: 20,
		isTerminal: false,
		requiresUserInput: false,
	},
	matching_credentials: {
		messageKey: 'protocolSteps.oid4vp.matchingCredentials',
		progress: 35,
		isTerminal: false,
		requiresUserInput: false,
	},
	awaiting_credential_selection: {
		messageKey: 'protocolSteps.oid4vp.awaitingCredentialSelection',
		progress: 45,
		isTerminal: false,
		requiresUserInput: true,
	},
	awaiting_consent: {
		messageKey: 'protocolSteps.oid4vp.awaitingConsent',
		progress: 55,
		isTerminal: false,
		requiresUserInput: true,
	},
	creating_presentation: {
		messageKey: 'protocolSteps.oid4vp.creatingPresentation',
		progress: 70,
		isTerminal: false,
		requiresUserInput: false,
	},
	sending_response: {
		messageKey: 'protocolSteps.oid4vp.sendingResponse',
		progress: 85,
		isTerminal: false,
		requiresUserInput: false,
	},
	completed: {
		messageKey: 'protocolSteps.oid4vp.completed',
		progress: 100,
		isTerminal: true,
		requiresUserInput: false,
	},
	error: {
		messageKey: 'protocolSteps.common.error',
		progress: 0,
		isTerminal: true,
		requiresUserInput: false,
	},
};

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
