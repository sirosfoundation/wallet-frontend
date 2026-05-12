/**
 * WMP Transport
 *
 * This transport implementation connects to the wallet backend via WMP
 * (JSON-RPC 2.0 over HTTP+SSE) for orchestrating OID4VCI and OID4VP flows.
 *
 * Replaces WebSocket transport with a stateless HTTP POST + SSE design:
 * - JSON-RPC requests sent via POST to /wmp/rpc
 * - Server notifications (progress, sign_request, match_request, etc.)
 *   streamed via SSE from /wmp/events
 *
 * Uses @sirosfoundation/wmp Peer for JSON-RPC framing and dispatch.
 */

import {
	Peer,
	HttpSseTransport as WmpHttpSseTransport,
	type Handler as WmpHandler,
	type FlowProgressParams,
	type FlowCompleteParams,
	type FlowErrorParams,
	type FlowActionParams,
	type FlowActionResult,
} from '@sirosfoundation/wmp-js';

import { TrustStatus as TrustStatusEnum } from 'wallet-common';
import type { IOIDFlowTransport } from '../types/IOIDFlowTransport';
import type {
	OIDFlowRequest,
	OIDFlowResponse,
	OIDFlowProgressEvent,
} from '../types/OIDFlowTypes';
import type { OID4VCIFlowParams, OID4VCIFlowResult, OID4VCIIssuerInfo } from '../types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult, OID4VPVerifierInfo } from '../types/OID4VPTypes';
import type { CredentialsMatchedResult } from '@/services/CredentialMatchingService';
import { logger } from '@/logger';
import type { TrustEvaluators, TrustStatus } from '../types';
import { DcqlQuery } from 'dcql';

// ===== Exported types (re-used by context) =====

export interface SignRequest {
	flowId: string;
	messageId: string;
	action: 'generate_proof' | 'sign_presentation';
	params: {
		audience?: string;
		nonce?: string;
		issuer?: string;
		proofType?: string;
		proofTypesSupported?: ProofTypesSupported;
		count?: number;
		credentialsToInclude?: Array<{
			credentialId: string;
			credentialQueryId?: string;
			disclosedClaims?: string[];
			credentialRaw?: string;
		}>;
	};
}

interface ProofTypeConfig {
	key_attestations_required?: Record<string, unknown> | null;
	proof_signing_alg_values_supported: string[];
}

interface ProofTypesSupported {
	jwt?: ProofTypeConfig;
	attestation?: ProofTypeConfig;
	cwt?: ProofTypeConfig;
}

export interface ProofObject {
	proof_type: 'jwt' | 'cwt' | 'attestation';
	jwt?: string;
	cwt?: string;
	attestation?: string;
}

export interface SignResponse {
	proofJwt?: string;
	proofs?: ProofObject[];
	vpToken?: string;
}

export type SignRequestHandler = (request: SignRequest) => Promise<SignResponse>;

export interface MatchRequest {
	flowId: string;
	messageId: string;
	dcqlQuery: DcqlQuery.Input;
}

export type MatchResponse = CredentialsMatchedResult;
export type MatchRequestHandler = (request: MatchRequest) => Promise<MatchResponse>;

export interface FlowAction {
	flowId: string;
	action: string;
	payload: Record<string, unknown>;
}

// ===== Internal helpers =====

/** Map engine-style issuer_info to typed OID4VCIIssuerInfo */
function mapIssuerInfo(raw: Record<string, unknown>): OID4VCIIssuerInfo {
	const trust = raw.trust as Record<string, unknown> | undefined;
	return {
		name: raw.name as string | undefined,
		identifier: (raw.identifier ?? raw.credential_issuer) as string | undefined,
		logo: raw.logo_uri as string | undefined,
		trustedStatus: mapTrustStatus(trust?.status as string | undefined),
		reason: trust?.reason as string | undefined,
		metadata: trust?.metadata as Record<string, unknown> | undefined,
	};
}

/** Map engine-style verifier info to typed OID4VPVerifierInfo */
function mapVerifierInfo(raw: Record<string, unknown>): OID4VPVerifierInfo {
	const trust = raw.trust as Record<string, unknown> | undefined;
	return {
		name: raw.name as string | undefined,
		domain: (raw.identifier ?? raw.client_id) as string | undefined,
		logo: raw.logo_uri as string | undefined,
		purpose: raw.purpose as string | undefined,
		trustedStatus: mapTrustStatus(trust?.status as string | undefined),
		reason: trust?.reason as string | undefined,
		metadata: trust?.metadata as Record<string, unknown> | undefined,
	};
}

function mapTrustStatus(status: string | undefined): TrustStatus {
	switch (status) {
		case 'trusted': return 'trusted';
		case 'untrusted': return 'untrusted';
		case 'unknown': return 'unknown';
		default: return 'unknown';
	}
}

// ===== Flow promise tracking =====

/** Tracks an in-flight flow waiting for a terminal result. */
interface FlowPromise {
	resolve: (msg: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * WMP Transport implementation
 *
 * Uses @sirosfoundation/wmp Peer over HTTP+SSE to communicate with the
 * wallet backend engine. The Peer handles JSON-RPC framing, request/response
 * correlation, and session management. This class maps between the
 * IOIDFlowTransport interface and WMP flow methods.
 */
export class OIDFlowWmpTransport implements IOIDFlowTransport {
	private rpcUrl: string;
	private eventsUrl: string;
	private authToken: string;
	private tenantId: string;

	private peer: Peer | null = null;
	private transport: WmpHttpSseTransport | null = null;
	private sessionId: string | null = null;
	private currentFlowId: string | null = null;

	private flowPromises = new Map<string, FlowPromise>();
	private progressCallbacks = new Set<(event: OIDFlowProgressEvent) => void>();
	private errorCallbacks = new Set<(error: Error) => void>();
	private signHandlers = new Set<SignRequestHandler>();
	private matchHandlers = new Set<MatchRequestHandler>();
	private vpCredentialCache = new Map<string, string>();

	private requestTimeout = 120_000; // 120 seconds for full flows
	private connected = false;

	private trustEvaluators: TrustEvaluators;

	constructor(
		rpcUrl: string,
		eventsUrl: string,
		authToken: string,
		tenantId: string = 'default',
		trustEvaluators?: TrustEvaluators,
	) {
		this.rpcUrl = rpcUrl;
		this.eventsUrl = eventsUrl;
		this.authToken = authToken;
		this.tenantId = tenantId;
		this.trustEvaluators = trustEvaluators ?? {
			evaluateIssuerTrust: async () => ({ trusted: false }),
			evaluateVerifierTrust: async () => ({ trusted: false }),
		};
	}

	getCurrentFlowId(): string | null {
		return this.currentFlowId;
	}

	// ===== Connection Lifecycle =====

	async connect(): Promise<void> {
		if (this.connected && this.peer) return;

		// Create WMP HTTP+SSE transport
		this.transport = new WmpHttpSseTransport(this.rpcUrl, this.eventsUrl, {
			authorization: `Bearer ${this.authToken}`,
		});

		// Create WMP peer with handler for incoming notifications
		this.peer = new Peer(this.transport, {
			callTimeout: this.requestTimeout,
			handler: this.createWmpHandler(),
		});

		// Create a WMP session (authenticates with the backend)
		const result = await this.peer.createSession({
			auth: { type: 'bearer', token: this.authToken },
		});

		this.sessionId = result.wmp?.session_id ?? null;
		if (!this.sessionId) {
			throw new Error('WMP session creation failed: no session_id returned');
		}

		// Now connect the SSE stream with the session ID bound
		this.transport.connectSSE();
		this.connected = true;
	}

	async disconnect(): Promise<void> {
		// Reject all pending flow promises
		for (const [flowId, fp] of this.flowPromises) {
			clearTimeout(fp.timeout);
			fp.reject(new Error('Transport disconnected'));
		}
		this.flowPromises.clear();

		if (this.peer) {
			try {
				await this.peer.closeSession();
			} catch {
				// Best-effort
			}
			this.peer.close();
			this.peer = null;
		}
		this.transport = null;
		this.sessionId = null;
		this.currentFlowId = null;
		this.connected = false;
		this.vpCredentialCache.clear();
	}

	isConnected(): boolean {
		return this.connected && this.peer !== null;
	}

	// ===== OID4VCI Flow =====

	async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		if (!this.peer) throw new Error('WMP transport not connected');

		// Resumption: same-tab redirect returned with auth code
		if (params.authorizationCode && params.credentialOffer) {
			return this.startFlowAndWait('oid4vci', {
				offer: params.credentialOffer,
				redirect_uri: params.redirectUri,
				auth_code: params.authorizationCode,
				code_verifier: params.codeVerifier,
			}, (msg) => this.mapOID4VCIResponse(msg));
		}

		if (params.credentialOfferUri || params.credentialOffer) {
			return this.startFlowAndWait('oid4vci', {
				credential_offer_uri: params.credentialOfferUri,
				offer: params.credentialOffer,
				redirect_uri: params.redirectUri,
			}, (msg) => this.mapOID4VCIResponse(msg));
		}

		if (params.holderBinding && params.credentialConfigurationId) {
			return this.sendActionAndWait('consent', {
				holder_public_key: params.holderBinding.publicKeyJwk,
				holder_binding_method: params.holderBinding.method,
				credential_configuration_id: params.credentialConfigurationId,
			}, (msg) => this.mapOID4VCIResponse(msg));
		}

		if (params.authorizationCode) {
			return this.sendActionAndWait('authorization_complete', {
				code: params.authorizationCode,
				code_verifier: params.codeVerifier,
				state: params.state,
			}, (msg) => this.mapOID4VCIResponse(msg));
		}

		if (params.preAuthorizedCode) {
			return this.sendActionAndWait('provide_pin', {
				pre_authorized_code: params.preAuthorizedCode,
				tx_code: params.txCodeInput,
			}, (msg) => this.mapOID4VCIResponse(msg));
		}

		throw new Error('Invalid OID4VCI flow params: no valid entry point or continuation');
	}

	private mapOID4VCIResponse(response: Record<string, unknown>): OID4VCIFlowResult {
		const type = response.type as string;
		if (type === 'error' || type === 'flow_error') {
			const error = response.error as { code?: string; message?: string } | undefined;
			return {
				success: false,
				error: {
					code: error?.code ?? String(response.code ?? 'UNKNOWN_ERROR'),
					message: error?.message ?? response.message as string ?? 'Unknown error',
				},
			};
		}

		const result: OID4VCIFlowResult = { success: true };
		const payload = response.payload as Record<string, unknown> | undefined;

		// Metadata phase
		if (payload?.issuer_metadata) {
			result.issuerMetadata = payload.issuer_metadata as OID4VCIFlowResult['issuerMetadata'];
		}
		if (payload?.issuer_info) {
			result.issuerInfo = mapIssuerInfo(payload.issuer_info as Record<string, unknown>);
		}
		if (payload?.credential_configurations) {
			result.credentialConfigurations = payload.credential_configurations as OID4VCIFlowResult['credentialConfigurations'];
		}
		if (payload?.selected_credential_configuration_id) {
			result.selectedCredentialConfigurationId = payload.selected_credential_configuration_id as string;
		} else if (response.selected_credential_configuration_id) {
			result.selectedCredentialConfigurationId = response.selected_credential_configuration_id as string;
		}

		// Authorization
		if (payload?.authorization_required !== undefined) {
			result.authorizationRequired = payload.authorization_required as boolean;
		}
		if (payload?.authorization_url) {
			result.authorizationUrl = payload.authorization_url as string;
		}
		if (payload?.code_verifier) {
			result.codeVerifier = payload.code_verifier as string;
		}
		if (payload?.state) {
			result.issuerState = payload.state as string;
		}

		// Credential offer
		if (payload?.credential_offer) {
			result.credentialOffer = payload.credential_offer as OID4VCIFlowResult['credentialOffer'];
		}

		if (!result.selectedCredentialConfigurationId && result.credentialOffer?.credential_configuration_ids?.length) {
			result.selectedCredentialConfigurationId = result.credentialOffer.credential_configuration_ids[0];
		}

		// Credential issuer identifier
		if (payload?.credential_issuer) {
			result.credentialIssuerIdentifier = payload.credential_issuer as string;
		} else if (response.credential_issuer) {
			result.credentialIssuerIdentifier = response.credential_issuer as string;
		} else if (result.issuerInfo?.identifier) {
			result.credentialIssuerIdentifier = result.issuerInfo.identifier;
		} else if (result.credentialOffer?.credential_issuer) {
			result.credentialIssuerIdentifier = result.credentialOffer.credential_issuer;
		}

		// Pre-auth
		if (payload?.pre_authorized_code) {
			result.preAuthorizedCode = payload.pre_authorized_code as string;
		}
		if (payload?.tx_code) {
			result.txCode = payload.tx_code as OID4VCIFlowResult['txCode'];
		}

		// Credential
		if (response.credential) {
			result.credential = response.credential as string;
		}
		if (response.format) {
			result.format = response.format as string;
		}
		if (response.credentials && Array.isArray(response.credentials)) {
			result.credentials = response.credentials as Array<{ format: string; credential: string; vct?: string }>;
		}

		// Deferred
		if (response.transactionId) {
			result.transactionId = response.transactionId as string;
		}

		return result;
	}

	// ===== OID4VP Flow =====

	async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
		if (!this.peer) throw new Error('WMP transport not connected');

		if (params.requestUriRef && params.clientId && !params.selectedCredentials) {
			return this.startFlowAndWait('oid4vp', {
				request_uri_ref: params.requestUriRef,
				client_id: params.clientId,
			}, (msg) => this.mapOID4VPResponse(msg));
		}

		if (params.selectedCredentials) {
			for (const c of params.selectedCredentials) {
				this.vpCredentialCache.set(c.walletCredentialRef, c.credentialRaw);
			}
			return this.sendActionAndWait('consent', {
				selected_credentials: params.selectedCredentials.map(c => ({
					credential_id: c.walletCredentialRef,
					credential_query_id: c.credentialQueryId,
					disclosed_claims: c.disclosedClaims ?? [],
				})),
			}, (msg) => this.mapOID4VPResponse(msg));
		}

		throw new Error('Invalid OID4VP flow params: no valid entry point or continuation');
	}

	private mapOID4VPResponse(response: Record<string, unknown>): OID4VPFlowResult {
		const type = response.type as string;
		if (type === 'error' || type === 'flow_error') {
			const error = response.error as { code?: string; message?: string } | undefined;
			return {
				success: false,
				error: {
					code: error?.code ?? String(response.code ?? 'UNKNOWN_ERROR'),
					message: error?.message ?? response.message as string ?? 'Unknown error',
				},
			};
		}

		const result: OID4VPFlowResult = { success: true };
		const payload = response.payload as Record<string, unknown> | undefined;

		if (payload?.dcql_query) {
			result.dcqlQuery = payload.dcql_query as DcqlQuery.Input;
		}
		if (payload?.verifier) {
			result.verifierInfo = mapVerifierInfo(payload.verifier as Record<string, unknown>);
		}

		const credentialSets = (payload?.dcql_query as Record<string, unknown> | undefined)?.credential_sets;
		if (Array.isArray(credentialSets) && (credentialSets[0] as Record<string, unknown>)?.purpose && result.verifierInfo) {
			result.verifierInfo.purpose = (credentialSets[0] as Record<string, unknown>).purpose as string;
		}

		if (response.presentation_definition) {
			result.presentationDefinition = response.presentation_definition;
		}
		if (response.conformant_credentials) {
			const creds = response.conformant_credentials;
			if (creds instanceof Map) {
				result.conformantCredentials = creds as OID4VPFlowResult['conformantCredentials'];
			} else if (typeof creds === 'object') {
				result.conformantCredentials = new Map(
					Object.entries(creds as Record<string, unknown>)
				) as OID4VPFlowResult['conformantCredentials'];
			}
		}
		if (response.verifier_info) {
			result.verifierInfo = mapVerifierInfo(response.verifier_info as Record<string, unknown>);
		}
		if (response.transaction_data) {
			result.transactionData = response.transaction_data as OID4VPFlowResult['transactionData'];
		}
		if (response.redirect_uri) {
			result.redirectUri = response.redirect_uri as string;
		}
		if (response.response_data) {
			result.responseData = response.response_data;
		}

		return result;
	}

	// ===== Generic Request =====

	async request<T>(flowRequest: OIDFlowRequest): Promise<OIDFlowResponse<T>> {
		try {
			if (!this.peer) throw new Error('WMP transport not connected');

			const result = await this.peer.call<T>('generic.request', {
				flowType: flowRequest.type,
				action: flowRequest.action,
				payload: flowRequest.payload,
			});

			return { success: true, data: result };
		} catch (error) {
			return {
				success: false,
				error: {
					code: 'WMP_ERROR',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
			};
		}
	}

	// ===== Event Subscriptions =====

	onProgress(callback: (event: OIDFlowProgressEvent) => void): () => void {
		this.progressCallbacks.add(callback);
		return () => this.progressCallbacks.delete(callback);
	}

	onError(callback: (error: Error) => void): () => void {
		this.errorCallbacks.add(callback);
		return () => this.errorCallbacks.delete(callback);
	}

	onSignRequest(handler: SignRequestHandler): () => void {
		this.signHandlers.add(handler);
		return () => this.signHandlers.delete(handler);
	}

	onMatchRequest(handler: MatchRequestHandler): () => void {
		this.matchHandlers.add(handler);
		return () => this.matchHandlers.delete(handler);
	}

	updateAuthToken(token: string, tenantId?: string): void {
		this.authToken = token;
		if (tenantId !== undefined) {
			this.tenantId = tenantId;
		}
		// Update transport authorization header
		if (this.transport) {
			this.transport.setAuthorization(`Bearer ${token}`);
		}
	}

	sendFlowAction(action: FlowAction): void {
		if (!this.peer) {
			logger.error('Cannot send flow action: WMP peer not connected');
			return;
		}

		this.peer.flowAction(action.flowId, action.action, action.payload)
			.catch(err => logger.error('Failed to send flow action:', err));
	}

	// ===== Flow orchestration =====

	/**
	 * Start a WMP flow and wait for the terminal result.
	 * The Peer.startFlow sends the JSON-RPC request; subsequent server
	 * notifications (progress, sign_request, etc.) are handled by the
	 * WmpHandler callbacks. The flow promise resolves on flow.complete or
	 * rejects on flow.error.
	 */
	private async startFlowAndWait<T>(
		protocol: string,
		params: Record<string, unknown>,
		mapper: (msg: Record<string, unknown>) => T,
	): Promise<T> {
		if (!this.peer) throw new Error('WMP transport not connected');

		const flowId = crypto.randomUUID();
		this.currentFlowId = flowId;

		// Start the flow via JSON-RPC request
		await this.peer.startFlow(protocol, flowId, params);

		// Wait for the terminal result (flow.complete or flow.error notification,
		// or an intermediate progress that needs to resolve to the caller)
		const msg = await this.waitForFlowResult(flowId);
		return mapper(msg);
	}

	/**
	 * Send a flow action and wait for the terminal result.
	 * Used for continuation steps (consent, authorization_complete, etc.).
	 */
	private async sendActionAndWait<T>(
		action: string,
		payload: Record<string, unknown>,
		mapper: (msg: Record<string, unknown>) => T,
	): Promise<T> {
		if (!this.peer || !this.currentFlowId) {
			throw new Error('No active flow');
		}

		const flowId = this.currentFlowId;

		// Send the action via JSON-RPC request
		await this.peer.flowAction(flowId, action, payload);

		// Wait for the next terminal/resolvable result
		const msg = await this.waitForFlowResult(flowId);
		return mapper(msg);
	}

	/**
	 * Wait for a flow result. Returns a promise that resolves when the server
	 * sends a terminal notification (flow.complete, flow.error) or an
	 * intermediate progress stage that the caller needs to act on
	 * (authorization_required, credential_selection).
	 */
	private waitForFlowResult(flowId: string): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.flowPromises.delete(flowId);
				reject(new Error('Flow timeout'));
			}, this.requestTimeout);

			this.flowPromises.set(flowId, { resolve, reject, timeout });
		});
	}

	/** Resolve the flow promise for the given flow ID. */
	private resolveFlow(flowId: string, msg: Record<string, unknown>): void {
		const fp = this.flowPromises.get(flowId);
		if (fp) {
			clearTimeout(fp.timeout);
			this.flowPromises.delete(flowId);
			fp.resolve(msg);
		}
	}

	/** Reject the flow promise for the given flow ID. */
	private rejectFlow(flowId: string, error: Error): void {
		const fp = this.flowPromises.get(flowId);
		if (fp) {
			clearTimeout(fp.timeout);
			this.flowPromises.delete(flowId);
			fp.reject(error);
		}
	}

	// ===== WMP Handler (incoming notifications from server) =====

	/**
	 * Creates the WmpHandler that receives server-initiated notifications
	 * and dispatches them to flow promises, sign/match handlers, etc.
	 */
	private createWmpHandler(): WmpHandler {
		return {
			onFlowProgress: (params: FlowProgressParams) => {
				const flowId = params.flow_id;
				const step = params.step;
				const payload = params.payload as Record<string, unknown> | undefined;

				// Handle trust evaluation
				if (
					(step === 'evaluating_trust' || step === 'evaluating_verifier_trust') &&
					payload?.trust_evaluation_required
				) {
					this.handleTrustEvaluationStep(flowId, payload);
				}

				// Handle sign_request delivered as progress step
				if (step === 'sign_request') {
					this.handleSignRequest(flowId, payload ?? {});
					return;
				}

				// Handle match_request delivered as progress step
				if (step === 'match_request') {
					this.handleMatchRequest(flowId, payload ?? {});
					return;
				}

				// Resolve flow promise for stages that need user action
				if (
					step === 'authorization_required' &&
					(payload?.authorization_url || payload?.pre_authorized_code)
				) {
					this.resolveFlow(flowId, {
						type: 'flow_progress',
						step,
						payload,
					});
				}

				if (step === 'credential_selection') {
					this.resolveFlow(flowId, {
						type: 'flow_progress',
						step,
						payload,
					});
				}

				// Emit progress to all subscribers
				this.emitProgress({
					flowId,
					stage: step,
					payload,
				});
			},

			onFlowComplete: (params: FlowCompleteParams) => {
				const flowId = params.flow_id;
				const result = params.result as Record<string, unknown> | undefined;

				this.resolveFlow(flowId, {
					type: 'flow_complete',
					...result,
				});

				this.currentFlowId = null;
				this.vpCredentialCache.clear();
			},

			onFlowError: (params: FlowErrorParams) => {
				const flowId = params.flow_id;

				this.resolveFlow(flowId, {
					type: 'flow_error',
					error: {
						code: String(params.code),
						message: params.message,
					},
					code: params.code,
					message: params.message,
				});

				this.currentFlowId = null;
				this.vpCredentialCache.clear();
			},

			// flow.action is server→client only for special cases
			onFlowAction: async (params: FlowActionParams): Promise<FlowActionResult> => {
				// This path handles server-initiated action requests if the backend
				// uses flow.action instead of flow.progress for sign/match.
				const action = params.action;
				const flowId = params.flow_id;
				const actionParams = params.params as Record<string, unknown> | undefined;

				if (action === 'sign_request') {
					await this.handleSignRequest(flowId, actionParams ?? {});
				} else if (action === 'match_request') {
					await this.handleMatchRequest(flowId, actionParams ?? {});
				}

				return {
					wmp: { version: '0.1', session_id: this.sessionId ?? '' },
					flow_id: flowId,
					action,
					status: 'accepted',
				};
			},
		};
	}

	// ===== Trust Evaluation =====

	private async handleTrustEvaluationStep(flowId: string, payload: Record<string, unknown>): Promise<void> {
		const request = payload.request as {
			subject_id: string;
			subject_type: string;
			key_material?: { type: string; x5c?: string[]; jwk?: unknown };
			context?: Record<string, unknown>;
		} | undefined;

		if (!request?.subject_id) {
			logger.error('[WMP Transport] Trust evaluation request missing subject_id');
			this.sendTrustResult(flowId, { trusted: false, reason: 'Missing subject_id' });
			return;
		}

		try {
			let result: { trusted: boolean; status?: TrustStatusEnum; metadata?: Record<string, unknown> } | null = null;

			switch (request.subject_type) {
				case 'credential_issuer':
					result = await this.trustEvaluators.evaluateIssuerTrust({
						issuerId: request.subject_id,
						keyMaterial: request.key_material ? {
							type: request.key_material.type as 'jwk' | 'x5c',
							key: request.key_material.x5c ?? request.key_material.jwk,
						} : undefined,
						context: request.context,
					});
					break;
				case 'credential_verifier': {
					const scheme = (request.context?.client_id_scheme as string) || 'x509_san_dns';
					const clientId = request.subject_id;
					let identifier = clientId;
					if (scheme === 'x509_san_dns' && clientId.startsWith('x509_san_dns:')) {
						identifier = clientId.slice('x509_san_dns:'.length);
					}
					result = await this.trustEvaluators.evaluateVerifierTrust({
						clientIdScheme: {
							scheme: scheme as 'x509_san_dns' | 'did' | 'https' | 'pre-registered',
							clientId,
							identifier,
						},
						keyMaterial: request.key_material
							? {
								type: request.key_material.type as 'jwk' | 'x5c' | 'kid',
								key: request.key_material.x5c ?? request.key_material.jwk,
							}
							: { type: 'kid' as const, key: '' },
						responseUri: request.context?.response_uri as string | undefined,
					});
					break;
				}
				default:
					throw new Error(`Unknown subject_type: ${request.subject_type}`);
			}

			this.sendTrustResult(flowId, {
				trusted: result?.trusted ?? false,
				framework: result?.metadata?.framework as string | undefined,
				reason: result?.metadata?.reason as string | undefined,
			});
		} catch (error) {
			logger.error('[WMP Transport] Trust evaluation failed:', error);
			this.sendTrustResult(flowId, {
				trusted: false,
				reason: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	private sendTrustResult(flowId: string, result: { trusted: boolean; framework?: string; reason?: string }): void {
		if (!this.peer) return;
		this.peer.flowAction(flowId, 'trust_result', result)
			.catch(err => logger.error('Failed to send trust result:', err));
	}

	// ===== Sign Request Handling =====

	private async handleSignRequest(flowId: string, rawParams: Record<string, unknown>): Promise<void> {
		const messageId = (rawParams.message_id as string) || '';

		const request: SignRequest = {
			flowId,
			messageId,
			action: (rawParams.action as 'generate_proof' | 'sign_presentation') || 'generate_proof',
			params: {
				audience: rawParams.audience as string | undefined,
				issuer: rawParams.issuer as string | undefined,
				nonce: rawParams.nonce as string | undefined,
				proofType: rawParams.proof_type as string | undefined,
				proofTypesSupported: rawParams.proof_types_supported as SignRequest['params']['proofTypesSupported'],
				count: rawParams.count as number | undefined,
				credentialsToInclude: (
					rawParams.credentials_to_include as Array<{
						credential_id: string;
						credential_query_id?: string;
						disclosed_claims?: string[];
					}> | undefined
				)?.map(c => ({
					credentialId: c.credential_id,
					credentialQueryId: c.credential_query_id,
					disclosedClaims: c.disclosed_claims,
					credentialRaw: this.vpCredentialCache.get(c.credential_id),
				})),
			},
		};

		if (this.signHandlers.size === 0) {
			logger.error('No sign handlers registered');
			this.sendSignResponse(flowId, messageId, {}, 'No sign handler available');
			return;
		}

		let lastError: Error | null = null;
		for (const handler of this.signHandlers) {
			try {
				const response = await handler(request);
				this.sendSignResponse(flowId, messageId, response);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('Sign handler failed:', lastError.message);
			}
		}

		this.sendSignResponse(flowId, messageId, {}, lastError?.message || 'Sign operation failed');
	}

	private sendSignResponse(
		flowId: string,
		messageId: string,
		response: SignResponse,
		error?: string,
	): void {
		if (!this.peer) return;

		const params: Record<string, unknown> = {
			message_id: messageId,
		};

		if (error) {
			params.error = error;
		} else {
			if (response.proofJwt) params.proof_jwt = response.proofJwt;
			if (response.proofs) params.proofs = response.proofs;
			if (response.vpToken) params.vp_token = response.vpToken;
		}

		this.peer.flowAction(flowId, 'sign_response', params)
			.catch(err => logger.error('Failed to send sign response:', err));
	}

	// ===== Match Request Handling =====

	private async handleMatchRequest(flowId: string, rawParams: Record<string, unknown>): Promise<void> {
		const messageId = (rawParams.message_id as string) || '';
		const dcqlQuery = rawParams.dcql_query as DcqlQuery.Input | undefined;

		if (!dcqlQuery || typeof dcqlQuery !== 'object') {
			logger.error('Malformed match request: missing dcql_query');
			this.sendMatchResponse(flowId, messageId, { matches: [] }, 'Missing required dcql_query');
			return;
		}

		const request: MatchRequest = { flowId, messageId, dcqlQuery };

		if (this.matchHandlers.size === 0) {
			logger.error('No match handlers registered');
			this.sendMatchResponse(flowId, messageId, { matches: [] }, 'No match handler available');
			return;
		}

		let lastError: Error | null = null;
		for (const handler of this.matchHandlers) {
			try {
				const response = await handler(request);
				this.sendMatchResponse(flowId, messageId, response);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('Match handler failed:', lastError.message);
			}
		}

		this.sendMatchResponse(flowId, messageId, { matches: [] }, lastError?.message || 'Credential matching failed');
	}

	private sendMatchResponse(
		flowId: string,
		messageId: string,
		response: MatchResponse,
		error?: string,
	): void {
		if (!this.peer) return;

		const params: Record<string, unknown> = {
			message_id: messageId,
			matches: response.matches,
		};

		if (error) {
			params.error = error;
		}
		if (response.no_match_reason) {
			params.no_match_reason = response.no_match_reason;
		}

		this.peer.flowAction(flowId, 'match_response', params)
			.catch(err => logger.error('Failed to send match response:', err));
	}

	// ===== Helpers =====

	private emitProgress(event: OIDFlowProgressEvent): void {
		for (const callback of this.progressCallbacks) {
			try {
				callback(event);
			} catch (e) {
				logger.error('Error in progress callback:', e);
			}
		}
	}

	private emitError(error: Error): void {
		for (const callback of this.errorCallbacks) {
			try {
				callback(error);
			} catch (e) {
				logger.error('Error in error callback:', e);
			}
		}
	}
}
