/**
 * Common flow types for transport abstraction
 */

/**
 * Generic callback URL type for OpenID flows, with specific subtypes for
 * credential offers, authorization codes, presentation requests, and errors.
 */
export type OIDFlowCallbackURLType<P extends string, T extends string> = {
	protocol: P;
	type: T;
	url: URL;
};

export type OIDFlowCredentialOfferCallback = OIDFlowCallbackURLType<'oid4vci', 'credential_offer'>;
export type OIDFlowAuthorizationCodeCallback = OIDFlowCallbackURLType<'oid4vci', 'authorization_code'>;
export type OIDFlowPresentationRequestCallback = OIDFlowCallbackURLType<'oid4vp', 'presentation_request'>;
export type OIDFlowAuthorizationErrorCallback = OIDFlowCallbackURLType<'unknown', 'authorization_error'>;
export type OIDFlowUnknownCallback = OIDFlowCallbackURLType<'unknown', 'unknown'>;
export type OIDFlowNoCallback = OIDFlowCallbackURLType<'none', 'none'>;

/**
 * Union type for all possible OpenID flow callback URLs, used for parsing and handling
 * different flow entry points.
 */
export type OIDFlowCallbackURL =
	| OIDFlowCredentialOfferCallback
	| OIDFlowAuthorizationCodeCallback
	| OIDFlowPresentationRequestCallback
	| OIDFlowAuthorizationErrorCallback
	| OIDFlowUnknownCallback
	| OIDFlowNoCallback;


/**
 * Transport type enumeration
 */
export type OIDFlowTransportType = 'http_proxy' | 'websocket' | 'direct';
export type OIDFlowActiveTransportType = OIDFlowTransportType | 'none';

/**
 * Generic flow request that can be sent to any transport
 */
export interface OIDFlowRequest {
	/** The type of flow being requested */
	type: 'oid4vci' | 'oid4vp' | 'vctm' | 'general';
	/** The action to perform */
	action: string;
	/** The payload for the request */
	payload: unknown;
}

/**
 * Generic flow response from any transport
 */
export interface OIDFlowResponse<T = unknown> {
	/** Whether the request succeeded */
	success: boolean;
	/** Response data (if success) */
	data?: T;
	/** Error information (if failure) */
	error?: OIDFlowTransportError;
}

/**
 * Flow error information
 */
export interface OIDFlowTransportError {
	/** Error code for programmatic handling */
	code: string;
	/** Human-readable error message */
	message: string;
	/** Optional additional details */
	details?: unknown;
}

/**
 * Progress event emitted during flow execution
 */
export interface OIDFlowProgressEvent {
	/** Unique identifier for the flow */
	flowId: string;
	/** Current stage of the flow */
	stage: string;
	/** Optional progress percentage (0-100) */
	progress?: number;
	/** Optional human-readable message */
	message?: string;
	/** Optional payload data from the server */
	payload?: unknown;
}

/**
 * Transport connection state
 */
export interface OIDFlowTransportConnectionState {
	/** Current transport type in use */
	transportType: OIDFlowActiveTransportType;
	/** Whether the transport is connected */
	isConnected: boolean;
	/** Available transports based on configuration */
	availableTransports: OIDFlowTransportType[];
}
