/**
 * WebSocket Transport
 *
 * This transport implementation connects to the wallet backend via WebSocket
 * for orchestrating OID4VCI and OID4VP flows. The backend handles all external
 * HTTP requests and sends progress updates back through the WebSocket.
 *
 * Benefits over HTTP proxy:
 * - Lower latency (persistent connection)
 * - Real-time progress updates
 * - Server can orchestrate multi-step flows
 * - Better error handling with flow state
 */

import type { IFlowTransport } from './types/IFlowTransport';
import type {
	FlowRequest,
	FlowResponse,
	FlowProgressEvent
} from './types/FlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult, OID4VCIIssuerInfo } from './types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult, OID4VPVerifierInfo } from './types/OID4VPTypes';
import type { TrustStatus } from './types/TrustTypes';
import type {
	PresentationDefinition,
	CredentialMatch,
	CredentialsMatchedResult,
} from '@/services/CredentialMatchingService';
import { logger } from '@/logger';

/**
 * Pending request waiting for a response
 */
interface PendingRequest<T = unknown> {
	resolve: (response: T) => void;
	reject: (error: Error) => void;
	flowId: string;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket message from server
 */
interface ServerMessage {
	flow_id?: string;  // snake_case from backend
	flowId?: string;   // camelCase for backwards compat
	type: string;
	[key: string]: unknown;
}

/**
 * Sign request from server
 */
export interface SignRequest {
	flowId: string;
	messageId: string;
	action: 'generate_proof' | 'sign_presentation';
	params: {
		audience?: string;
		nonce?: string;
		proofType?: string;
		credentialsToInclude?: Array<{
			credentialId: string;
			disclosedClaims?: string[];
		}>;
	};
}

/**
 * Sign response to send back to server
 */
export interface SignResponse {
	proofJwt?: string;
	vpToken?: string;
}

/**
 * Sign request handler callback type
 */
export type SignRequestHandler = (request: SignRequest) => Promise<SignResponse>;

/**
 * Credential match request from server
 * Sent when server needs client to match credentials locally for privacy
 */
export interface MatchRequest {
	flowId: string;
	messageId: string;
	presentationDefinition: PresentationDefinition;
}

/**
 * Credential match response to send back to server.
 * Re-uses CredentialsMatchedResult shape from CredentialMatchingService.
 */
export type MatchResponse = CredentialsMatchedResult;

/**
 * Match request handler callback type
 */
export type MatchRequestHandler = (request: MatchRequest) => Promise<MatchResponse>;

/**
 * Trust evaluation request from server.
 * Sent via flow_progress when the backend needs the frontend to evaluate
 * trust using the AuthZEN PDP (via /v1/evaluate and optionally /v1/resolve).
 */
export interface TrustEvaluationRequest {
	flowId: string;
	/** The subject identifier (client_id for verifiers, issuer URL for issuers) */
	subjectId: string;
	/** "credential_verifier" or "credential_issuer" */
	subjectType: string;
	/** Cryptographic key material for binding validation (nil for DID schemes) */
	keyMaterial?: {
		type: 'x5c' | 'jwk';
		x5c?: string[];
		jwk?: unknown;
	};
	/** Whether the frontend should resolve a DID document first */
	requiresResolution?: boolean;
	/** Signed request JWT (for DID schemes) */
	requestJwt?: string;
	/** Additional evaluation context */
	context?: Record<string, unknown>;
}

/**
 * Trust evaluation result to send back to server
 */
export interface TrustEvaluationResponse {
	trusted: boolean;
	name?: string;
	logo?: string;
	framework?: string;
	reason?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Trust evaluation handler callback type
 */
export type TrustEvaluationHandler = (request: TrustEvaluationRequest) => Promise<TrustEvaluationResponse>;

/**
 * Flow action message to send to server
 */
export interface FlowAction {
	flowId: string;
	action: string;
	payload: Record<string, unknown>;
}

/**
 * WebSocket Transport implementation
 */
export class WebSocketTransport implements IFlowTransport {
	private ws: WebSocket | null = null;
	private wsUrl: string;
	private authToken: string;
	private tenantId: string;

	private pending = new Map<string, PendingRequest>();
	private progressCallbacks = new Set<(event: FlowProgressEvent) => void>();
	private errorCallbacks = new Set<(error: Error) => void>();
	private signHandlers = new Set<SignRequestHandler>();
	private matchHandlers = new Set<MatchRequestHandler>();
	private trustHandlers = new Set<TrustEvaluationHandler>();

	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 1000;
	private requestTimeout = 60000; // 60 seconds

	private connectionPromise: Promise<void> | null = null;

	constructor(wsUrl: string, authToken: string, tenantId: string = 'default') {
		this.wsUrl = wsUrl;
		this.authToken = authToken;
		this.tenantId = tenantId;
	}

	// ===== Connection Lifecycle =====

	async connect(): Promise<void> {
		// If already connecting, return the existing promise
		if (this.connectionPromise) {
			return this.connectionPromise;
		}

		// If already connected, return immediately
		if (this.isConnected()) {
			return Promise.resolve();
		}

		this.connectionPromise = new Promise((resolve, reject) => {
			try {
				// Connect using the base WebSocket URL; send auth token in a message after connection
				const url = this.wsUrl;
				this.ws = new WebSocket(url);

				this.ws.onopen = () => {
					// Send auth token and tenant ID as first message for security (avoids logging in URL)
					try {
						if (this.ws && this.ws.readyState === WebSocket.OPEN) {
							this.ws.send(
								JSON.stringify({
									type: 'handshake',
									app_token: this.authToken,
									tenantId: this.tenantId
								})
							);
						}
					} catch (e) {
						logger.error('Failed to send auth message over WebSocket:', e);
					}
					this.reconnectAttempts = 0;
					this.connectionPromise = null;
					resolve();
				};

				this.ws.onerror = (event) => {
					logger.error('WebSocket error:', event);
					this.connectionPromise = null;
					reject(new Error('WebSocket connection failed'));
				};

				this.ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data) as ServerMessage;
						this.handleMessage(message);
					} catch (e) {
						logger.error('Failed to parse WebSocket message:', e);
					}
				};

				this.ws.onclose = (event) => {
					this.handleDisconnect(event);
				};
			} catch (error) {
				this.connectionPromise = null;
				reject(error);
			}
		});

		return this.connectionPromise;
	}

	async disconnect(): Promise<void> {
		if (this.ws) {
			// Cancel all pending requests
			Array.from(this.pending.entries()).forEach(([id, pending]) => {
				clearTimeout(pending.timeout);
				pending.reject(new Error('WebSocket disconnected'));
			});
			this.pending.clear();

			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}
		this.connectionPromise = null;
	}

	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	// ===== OID4VCI Flow =====

	async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		// Determine which phase of the flow we're in based on params

		if (params.credentialOfferUri || params.credentialOffer) {
			// Phase 1: Start flow with credential offer
			const response = await this.send({
				type: 'flow_start',
				protocol: 'oid4vci',
				credential_offer_uri: params.credentialOfferUri,
				offer: params.credentialOffer,
			});

			return this.mapOID4VCIResponse(response);
		}

		if (params.holderBinding && params.credentialConfigurationId) {
			// Phase 2: User consented, provide holder binding
			const response = await this.send({
				type: 'flow_action',
				action: 'consent',
				payload: {
					holder_public_key: params.holderBinding.publicKeyJwk,
					holder_binding_method: params.holderBinding.method,
					credential_configuration_id: params.credentialConfigurationId,
				},
			});

			return this.mapOID4VCIResponse(response);
		}

		if (params.authorizationCode) {
			// Phase 3: Authorization code received
			const response = await this.send({
				type: 'flow_action',
				action: 'authorization_complete',
				payload: {
					authorization_code: params.authorizationCode,
					code_verifier: params.codeVerifier,
				},
			});

			return this.mapOID4VCIResponse(response);
		}

		if (params.preAuthorizedCode) {
			// Pre-authorized flow
			const response = await this.send({
				type: 'flow_action',
				action: 'provide_pin',
				payload: {
					pre_authorized_code: params.preAuthorizedCode,
					tx_code: params.txCodeInput,
				},
			});

			return this.mapOID4VCIResponse(response);
		}

		throw new Error('Invalid OID4VCI flow params: no valid entry point or continuation');
	}

	private mapOID4VCIResponse(response: ServerMessage): OID4VCIFlowResult {
		if (response.type === 'error') {
			return {
				success: false,
				error: {
					code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
					message: (response.error as { message?: string })?.message ?? 'Unknown error',
				},
			};
		}

		// Map server response to OID4VCIFlowResult
		const result: OID4VCIFlowResult = {
			success: true,
		};

		// Metadata phase
		if (response.issuerMetadata) {
			result.issuerMetadata = response.issuerMetadata as OID4VCIFlowResult['issuerMetadata'];
		}
		if (response.issuerInfo) {
			result.issuerInfo = mapIssuerInfo(response.issuerInfo as Record<string, unknown>);
		}
		if (response.credentialConfigurations) {
			result.credentialConfigurations = response.credentialConfigurations as OID4VCIFlowResult['credentialConfigurations'];
		}
		if (response.selectedCredentialConfigurationId) {
			result.selectedCredentialConfigurationId = response.selectedCredentialConfigurationId as string;
		}

		// Authorization
		if (response.authorizationRequired !== undefined) {
			result.authorizationRequired = response.authorizationRequired as boolean;
		}
		if (response.authorizationUrl) {
			result.authorizationUrl = response.authorizationUrl as string;
		}
		if (response.issuerState) {
			result.issuerState = response.issuerState as string;
		}

		// Pre-auth
		if (response.preAuthorizedCode) {
			result.preAuthorizedCode = response.preAuthorizedCode as string;
		}
		if (response.txCode) {
			result.txCode = response.txCode as OID4VCIFlowResult['txCode'];
		}

		// Credential
		if (response.credential) {
			result.credential = response.credential as string;
		}
		if (response.format) {
			result.format = response.format as string;
		}

		// Deferred
		if (response.transactionId) {
			result.transactionId = response.transactionId as string;
		}

		return result;
	}

	// ===== OID4VP Flow =====

	async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
		if (params.authorizationRequestUri && !params.selectedCredentials) {
			// Phase 1: Start flow with authorization request
			const response = await this.send({
				type: 'flow_start',
				protocol: 'oid4vp',
				request_uri: params.authorizationRequestUri,
			});

			return this.mapOID4VPResponse(response);
		}

		if (params.selectedCredentials) {
			// Phase 2: User selected credentials, submit response
			const response = await this.send({
				type: 'flow_action',
				action: 'consent',
				payload: {
					selected_credentials: params.selectedCredentials,
				},
			});

			return this.mapOID4VPResponse(response);
		}

		throw new Error('Invalid OID4VP flow params: no valid entry point or continuation');
	}

	private mapOID4VPResponse(response: ServerMessage): OID4VPFlowResult {
		if (response.type === 'error') {
			return {
				success: false,
				error: {
					code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
					message: (response.error as { message?: string })?.message ?? 'Unknown error',
				},
			};
		}

		const result: OID4VPFlowResult = {
			success: true,
		};

		// Presentation definition phase
		if (response.presentationDefinition) {
			result.presentationDefinition = response.presentationDefinition as OID4VPFlowResult['presentationDefinition'];
		}
		if (response.conformantCredentials) {
			// Convert from object to Map if needed
			const creds = response.conformantCredentials;
			if (creds instanceof Map) {
				result.conformantCredentials = creds;
			} else if (typeof creds === 'object') {
				result.conformantCredentials = new Map(Object.entries(creds as Record<string, unknown[]>));
			}
		}
		if (response.verifierInfo) {
			result.verifierInfo = mapVerifierInfo(response.verifierInfo as Record<string, unknown>);
		}
		if (response.transactionData) {
			result.transactionData = response.transactionData as OID4VPFlowResult['transactionData'];
		}

		// Submission result
		if (response.redirectUri) {
			result.redirectUri = response.redirectUri as string;
		}
		if (response.responseData) {
			result.responseData = response.responseData;
		}

		return result;
	}

	// ===== Generic Request =====

	async request<T>(flowRequest: FlowRequest): Promise<FlowResponse<T>> {
		try {
			const response = await this.send({
				type: 'generic.request',
				flowType: flowRequest.type,
				action: flowRequest.action,
				payload: flowRequest.payload,
			});

			if (response.type === 'error') {
				return {
					success: false,
					error: {
						code: (response.error as { code?: string })?.code ?? 'UNKNOWN_ERROR',
						message: (response.error as { message?: string })?.message ?? 'Unknown error',
					},
				};
			}

			return {
				success: true,
				data: response.data as T,
			};
		} catch (error) {
			return {
				success: false,
				error: {
					code: 'WEBSOCKET_ERROR',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
			};
		}
	}

	// ===== Event Subscriptions =====

	onProgress(callback: (event: FlowProgressEvent) => void): () => void {
		this.progressCallbacks.add(callback);
		return () => this.progressCallbacks.delete(callback);
	}

	onError(callback: (error: Error) => void): () => void {
		this.errorCallbacks.add(callback);
		return () => this.errorCallbacks.delete(callback);
	}

	/**
	 * Register a handler for sign requests from the server.
	 * When the server needs a signature (proof or VP), it sends a sign_request.
	 * The handler should generate the signature and return it.
	 */
	onSignRequest(handler: SignRequestHandler): () => void {
		this.signHandlers.add(handler);
		return () => this.signHandlers.delete(handler);
	}

	/**
	 * Register a handler for credential match requests initiated by the server.
	 * The server sends a match_request containing a presentation definition;
	 * the handler evaluates it against local credentials and returns matching IDs/formats.
	 */
	onMatchRequest(handler: MatchRequestHandler): () => void {
		this.matchHandlers.add(handler);
		return () => this.matchHandlers.delete(handler);
	}

	/**
	 * Register a handler for trust evaluation requests from the server.
	 * When the server needs trust evaluation (verifier or issuer), it sends a
	 * flow_progress message with trust_evaluation_required. The handler should
	 * call the AuthZEN PDP (via /v1/evaluate) and return the result.
	 */
	onTrustEvaluation(handler: TrustEvaluationHandler): () => void {
		this.trustHandlers.add(handler);
		return () => this.trustHandlers.delete(handler);
	}

	// ===== Internal Methods =====

	private handleMessage(message: ServerMessage): void {
		// Support both snake_case (backend) and camelCase (legacy)
		const flowId = (message.flow_id as string) || (message.flowId as string);
		const { type } = message;

		// Handle progress events — check for trust evaluation requests first
		if (type === 'progress' || type === 'flow_progress') {
			const payload = message.payload as Record<string, unknown> | undefined;
			if (payload?.trust_evaluation_required) {
				void this.handleTrustEvaluationRequest(flowId, payload).catch((error: unknown) => {
					logger.error('Failed to handle trust evaluation request', { flowId, error });
				});
				return;
			}
			this.emitProgress({
				flowId,
				stage: (message.step as string) || (message.stage as string),
				progress: message.progress as number | undefined,
				message: message.message as string | undefined,
				payload: message.payload,
			});
			return;
		}

		// Handle sign requests from server
		if (type === 'sign_request') {
			this.handleSignRequest(message);
			return;
		}

		// Handle match requests from server (privacy-preserving credential matching)
		if (type === 'match_request' || type === 'match_credentials') {
			this.handleMatchRequest(message);
			return;
		}

		// All other message types resolve a pending request
		const pending = this.pending.get(flowId);
		if (pending) {
			clearTimeout(pending.timeout);
			this.pending.delete(flowId);

			// Resolve all non-progress, non-sign_request messages (including error/flow_error)
			// so higher-level callers can uniformly map them into success/error results.
			pending.resolve(message);
		} else {
			logger.warn('Received message for unknown flowId:', flowId);
		}
	}

	/**
	 * Handle a sign request from the server
	 */
	private async handleSignRequest(message: ServerMessage): Promise<void> {
		const flowId = (message.flow_id as string) || (message.flowId as string) || '';
		const request: SignRequest = {
			flowId,
			messageId: (message.message_id as string) || (message.messageId as string) || '',
			action: message.action as 'generate_proof' | 'sign_presentation',
			params: (message.params as SignRequest['params']) || {},
		};

		if (this.signHandlers.size === 0) {
			logger.error('No sign handlers registered, cannot respond to sign request');
			this.sendSignResponse(request.flowId, request.messageId, {}, 'No sign handler available');
			return;
		}

		// Call all handlers until one succeeds
		let lastError: Error | null = null;
		for (const handler of this.signHandlers) {
			try {
				const response = await handler(request);
				this.sendSignResponse(request.flowId, request.messageId, response);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('Sign handler failed:', lastError.message);
			}
		}

		// All handlers failed
		this.sendSignResponse(
			request.flowId,
			request.messageId,
			{},
			lastError?.message || 'Sign operation failed'
		);
	}

	/**
	 * Send a sign response back to the server
	 */
	private sendSignResponse(
		flowId: string,
		messageId: string,
		response: SignResponse,
		error?: string
	): void {
		if (!this.isConnected()) {
			logger.error('Cannot send sign response: WebSocket not connected');
			return;
		}

		const msg: Record<string, unknown> = {
			type: 'sign_response',
			flow_id: flowId,
			message_id: messageId,
			timestamp: new Date().toISOString(),
		};

		if (error) {
			msg.error = error;
		} else {
			if (response.proofJwt) msg.proof_jwt = response.proofJwt;
			if (response.vpToken) msg.vp_token = response.vpToken;
		}

		try {
			this.ws!.send(JSON.stringify(msg));
		} catch (err) {
			logger.error('Failed to send sign response:', err);
		}
	}

	/**
	 * Handle an incoming match_request from the server.
	 * The server initiates client-side credential matching by sending a
	 * presentation definition; the client evaluates it locally and responds
	 * with the matching credential IDs/formats — credentials never leave the device.
	 */
	private async handleMatchRequest(message: ServerMessage): Promise<void> {
		const flowId = (message.flow_id as string) || (message.flowId as string) || '';
		const messageId = (message.message_id as string) || (message.messageId as string) || '';
		const presentationDefinition =
			(message.presentation_definition as MatchRequest['presentationDefinition'])
			|| (message.presentationDefinition as MatchRequest['presentationDefinition']);

		if (!presentationDefinition || typeof presentationDefinition !== 'object') {
			logger.error('Malformed match request: missing required presentation_definition');
			this.sendMatchResponse(flowId, messageId, { matches: [] }, 'Missing required presentation_definition');
			return;
		}

		const request: MatchRequest = {
			flowId,
			messageId,
			presentationDefinition,
		};

		if (this.matchHandlers.size === 0) {
			logger.error('No match handlers registered, cannot respond to match request');
			this.sendMatchResponse(request.flowId, request.messageId, { matches: [] }, 'No match handler available');
			return;
		}

		// Call all handlers until one succeeds
		let lastError: Error | null = null;
		for (const handler of this.matchHandlers) {
			try {
				const response = await handler(request);
				this.sendMatchResponse(request.flowId, request.messageId, response);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('Match handler failed:', lastError.message);
			}
		}

		// All handlers failed
		this.sendMatchResponse(
			request.flowId,
			request.messageId,
			{ matches: [] },
			lastError?.message || 'Credential matching failed'
		);
	}

	/**
	 * Send a match response back to the server
	 */
	private sendMatchResponse(
		flowId: string,
		messageId: string,
		response: MatchResponse,
		error?: string
	): void {
		if (!this.isConnected()) {
			logger.error('Cannot send match response: WebSocket not connected');
			return;
		}

		const msg: Record<string, unknown> = {
			type: 'match_response',
			flow_id: flowId,
			message_id: messageId,
			timestamp: new Date().toISOString(),
		};

		if (error) {
			msg.error = error;
		} else {
			msg.matches = response.matches;
			if (response.no_match_reason) {
				msg.no_match_reason = response.no_match_reason;
			}
		}

		try {
			this.ws.send(JSON.stringify(msg));
		} catch (err) {
			logger.error('Failed to send match response:', err);
		}
	}

	/**
	 * Handle a trust evaluation request from a flow_progress message.
	 * The backend sends this when it needs the frontend to evaluate trust
	 * using the same TrustEvaluator used by the HTTP proxy path.
	 */
	private async handleTrustEvaluationRequest(
		flowId: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		const rawRequest = payload.request as Record<string, unknown> | undefined;
		if (!rawRequest?.subject_id) {
			logger.error('Malformed trust evaluation request: missing subject_id');
			this.sendTrustResult(flowId, { trusted: false, reason: 'Malformed request: missing subject_id' });
			return;
		}

		const SUPPORTED_SUBJECT_TYPES = ['credential_verifier', 'credential_issuer'] as const;
		type SupportedSubjectType = (typeof SUPPORTED_SUBJECT_TYPES)[number];
		const rawSubjectType = rawRequest.subject_type;
		if (
			!rawSubjectType ||
			!SUPPORTED_SUBJECT_TYPES.includes(rawSubjectType as SupportedSubjectType)
		) {
			logger.error('Malformed trust evaluation request: missing or unknown subject_type', {
				subject_type: rawSubjectType,
			});
			this.sendTrustResult(flowId, {
				trusted: false,
				reason: `Malformed request: unknown subject_type '${String(rawSubjectType)}'`,
			});
			return;
		}

		const request: TrustEvaluationRequest = {
			flowId,
			subjectId: rawRequest.subject_id as string,
			subjectType: rawRequest.subject_type as string,
			keyMaterial: rawRequest.key_material as TrustEvaluationRequest['keyMaterial'],
			requiresResolution: rawRequest.requires_resolution as boolean | undefined,
			requestJwt: rawRequest.request_jwt as string | undefined,
			context: rawRequest.context as Record<string, unknown> | undefined,
		};

		if (this.trustHandlers.size === 0) {
			logger.error('No trust handlers registered, cannot evaluate trust');
			this.sendTrustResult(flowId, { trusted: false, reason: 'No trust handler available' });
			return;
		}

		let lastError: Error | null = null;
		for (const handler of this.trustHandlers) {
			try {
				const response = await handler(request);
				this.sendTrustResult(flowId, response);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('Trust handler failed:', lastError.message);
			}
		}

		// All handlers failed — fail closed (untrusted)
		this.sendTrustResult(flowId, {
			trusted: false,
			reason: lastError?.message || 'Trust evaluation failed',
		});
	}

	/**
	 * Send a trust evaluation result back to the server as a flow_action.
	 */
	private sendTrustResult(flowId: string, response: TrustEvaluationResponse): void {
		if (!this.isConnected()) {
			logger.error('Cannot send trust result: WebSocket not connected');
			return;
		}

		const payload: {
			trusted: TrustEvaluationResponse['trusted'];
			name?: TrustEvaluationResponse['name'];
			logo?: TrustEvaluationResponse['logo'];
			framework?: TrustEvaluationResponse['framework'];
			reason?: TrustEvaluationResponse['reason'];
			metadata?: TrustEvaluationResponse['metadata'];
		} = {
			trusted: response.trusted,
		};

		if (response.name !== undefined) {
			payload.name = response.name;
		}
		if (response.logo !== undefined) {
			payload.logo = response.logo;
		}
		if (response.framework !== undefined) {
			payload.framework = response.framework;
		}
		if (response.reason !== undefined) {
			payload.reason = response.reason;
		}
		if (response.metadata !== undefined) {
			payload.metadata = response.metadata;
		}

		const msg = {
			type: 'flow_action',
			flow_id: flowId,
			action: 'trust_result',
			payload,
			timestamp: new Date().toISOString(),
		};

		try {
			this.ws!.send(JSON.stringify(msg));
		} catch (err) {
			logger.error('Failed to send trust result:', err);
		}
	}

	private handleDisconnect(event: CloseEvent): void {
		// Reject all pending requests
		Array.from(this.pending.entries()).forEach(([id, pending]) => {
			clearTimeout(pending.timeout);
			pending.reject(new Error('WebSocket disconnected'));
		});
		this.pending.clear();

		// Reset connection state
		this.ws = null;
		this.connectionPromise = null;

		// Don't reconnect if it was a clean close
		if (event.code === 1000) {
			return;
		}

		// Attempt reconnect with exponential backoff
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
			this.reconnectAttempts++;

			logger.debug(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

			setTimeout(() => {
				this.connect().catch((error) => {
					logger.error('WebSocket reconnect failed:', error);
					this.emitError(new Error('WebSocket reconnection failed'));
				});
			}, delay);
		} else {
			this.emitError(new Error('WebSocket connection lost after max reconnect attempts'));
		}
	}

	private send(message: Record<string, unknown>): Promise<ServerMessage> {
		return new Promise((resolve, reject) => {
			if (!this.isConnected()) {
				reject(new Error('WebSocket not connected'));
				return;
			}

			const flowId = (message.flow_id as string) || crypto.randomUUID();
			const fullMessage = { ...message, flow_id: flowId };

			// Set up timeout
			const timeout = setTimeout(() => {
				if (this.pending.has(flowId)) {
					this.pending.delete(flowId);
					reject(new Error('Request timeout'));
				}
			}, this.requestTimeout);

			// Store pending request
			this.pending.set(flowId, { resolve, reject, flowId, timeout });

			// Send message
			try {
				this.ws!.send(JSON.stringify(fullMessage));
			} catch (error) {
				clearTimeout(timeout);
				this.pending.delete(flowId);
				reject(error);
			}
		});
	}

	private emitProgress(event: FlowProgressEvent): void {
		Array.from(this.progressCallbacks).forEach(callback => {
			try {
				callback(event);
			} catch (e) {
				logger.error('Error in progress callback:', e);
			}
		});
	}

	private emitError(error: Error): void {
		Array.from(this.errorCallbacks).forEach(callback => {
			try {
				callback(error);
			} catch (e) {
				logger.error('Error in error callback:', e);
			}
		});
	}

	/**
	 * Update the auth token (e.g., after token refresh)
	 */
	updateAuthToken(token: string, tenantId?: string): void {
		this.authToken = token;
		if (tenantId !== undefined) {
			this.tenantId = tenantId;
		}
	}

	/**
	 * Send a flow action to the server.
	 * Used for responding to server requests during a flow (e.g., credential matching).
	 */
	sendFlowAction(action: FlowAction): void {
		if (!this.isConnected()) {
			logger.error('Cannot send flow action: WebSocket not connected');
			return;
		}

		const msg = {
			type: 'flow_action',
			flow_id: action.flowId,
			action: action.action,
			payload: action.payload,
			timestamp: new Date().toISOString(),
		};

		try {
			this.ws!.send(JSON.stringify(msg));
			logger.debug('[WS Transport] Sent flow action:', action.action);
		} catch (err) {
			logger.error('Failed to send flow action:', err);
		}
	}

	/**
	 * Get the current connection state
	 */
	getConnectionState(): {
		connected: boolean;
		reconnectAttempts: number;
		pendingRequests: number;
	} {
		return {
			connected: this.isConnected(),
			reconnectAttempts: this.reconnectAttempts,
			pendingRequests: this.pending.size,
		};
	}
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse a logo value from the backend.
 * Handles both string URLs and object formats with a `uri` field.
 */
function parseLogo(logo: unknown): string | undefined {
	if (logo == null) return undefined;
	if (typeof logo === 'string') return logo;
	if (typeof logo === 'object' && logo !== null) {
		return (logo as Record<string, unknown>).uri as string | undefined;
	}
	return undefined;
}

/**
 * Map a raw verifier info object from the backend into the typed frontend
 * representation. Handles the backend's snake_case `trusted_status` field
 * as well as the legacy `trusted` boolean.
 */
function mapVerifierInfo(raw: Record<string, unknown>): OID4VPVerifierInfo {
	return {
		name: raw.name as string | undefined,
		purpose: raw.purpose as string | undefined,
		trustedStatus: parseTrustStatus(raw.trusted_status, raw.trusted),
		reason: raw.reason as string | undefined,
		metadata: raw.metadata as Record<string, unknown> | undefined,
		domain: raw.domain as string | undefined,
		logo: parseLogo(raw.logo),
		clientIdScheme: raw.client_id_scheme as string | undefined,
		trustFramework: raw.framework as string | undefined,
	};
}

/**
 * Map a raw issuer info object from the backend into the typed frontend
 * representation. Handles the backend's snake_case `trusted_status` field
 * as well as the legacy `trusted` boolean.
 *
 * Returns undefined for identifier if the backend doesn't provide a valid string,
 * rather than defaulting to empty string which could mask wire-format issues.
 */
function mapIssuerInfo(raw: Record<string, unknown>): OID4VCIIssuerInfo {
	return {
		identifier: typeof raw.identifier === 'string' ? raw.identifier : undefined,
		name: raw.name as string | undefined,
		logo: parseLogo(raw.logo),
		trustedStatus: parseTrustStatus(raw.trusted_status, raw.trusted),
		reason: raw.reason as string | undefined,
		metadata: raw.metadata as Record<string, unknown> | undefined,
	};
}

/**
 * Parse a trust status value from the backend.
 *
 * Supports:
 * - New wire format: `trusted_status` string ("trusted"|"unknown"|"untrusted")
 * - Legacy wire format: `trusted` boolean → maps true→"trusted", false→"untrusted"
 * - Missing/null → "unknown"
 */
function parseTrustStatus(
	trustedStatus: unknown,
	legacyTrusted?: unknown,
): TrustStatus {
	// New format: string tri-state
	if (typeof trustedStatus === 'string') {
		if (trustedStatus === 'trusted' || trustedStatus === 'untrusted' || trustedStatus === 'unknown') {
			return trustedStatus;
		}
	}
	// Legacy format: boolean
	if (typeof legacyTrusted === 'boolean') {
		return legacyTrusted ? 'trusted' : 'untrusted';
	}
	return 'unknown';
}
