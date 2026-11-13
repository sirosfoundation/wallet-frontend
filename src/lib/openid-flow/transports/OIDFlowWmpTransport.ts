/**
 * WMP Transport (issuance and presentation)
 *
 * Runs OID4VCI and OID4VP over the Wallet Messaging Protocol (sirosfoundation/wmp:
 * Core, HTTPS binding, OpenID4x profile Sections 3.1 and 3.2) against the engine's
 * WMP bridge (go-wallet-backend #163: POST /api/v2/wallet/rpc, SSE at /rpc/events).
 *
 * It extends the WebSocket transport so it can stand in for it everywhere the
 * app expects one, but it does not open the WebSocket: the engine keeps one
 * session per user, and a WebSocket session and a WMP session push each other
 * out ("superseded"). The WMP session is the connection.
 *
 * Presentation (3.2): startOID4VPFlow({requestUriRef, clientId}) -> wmp.flow.start oid4vp,
 * resolving at awaiting_consent. startOID4VPFlow({selectedCredentials}) -> select_credentials
 * with only {query_id, selection_handle}: which credential and which claims stay here, keyed
 * by the handle, and the sign_presentation sub-flow is built from that record, never from what
 * the engine sends (3.2.3.1, "the wallet bounds disclosure"). reportNoMatchingCredentials() is
 * a decline (consent false).
 *
 * How the app's step-by-step calls map onto one WMP flow:
 *   startOID4VCIFlow({credentialOfferUri|credentialOffer})  -> wmp.flow.start oid4vci
 *   ...resolves on awaiting_tx_code, authorization_pending, wmp.flow.complete or wmp.flow.error
 *   startOID4VCIFlow({preAuthorizedCode, txCodeInput})      -> action provide_tx_code (same flow)
 *   startOID4VCIFlow({credentialOffer, authorizationCode})  -> a new oid4vci flow carrying
 *       auth_code + code_verifier (the page reloaded after the redirect, so this is a fresh session)
 *   awaiting_offer_acceptance is answered here (accept_offer, first configuration), as the
 *       engine's WebSocket flow does without asking the user.
 *
 * Sign sub-flows (3.1.5) the engine starts are answered by the app's existing sign handler
 * (generate_proof, sign_client_auth). Credential response encryption (3.1.5.1) is handled
 * here: an ephemeral P-256 key per request, decryption of the issuer's JWE in the browser,
 * and only control members (credential_count / transaction_id) back to the engine, which
 * never sees the credentials or the response's credential_metadata.
 */

import { CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from 'jose';
import type { DcqlQuery } from 'dcql';
import { OIDFlowWebSocketTransport, mapVerifierInfo } from './OIDFlowWebSocketTransport';
import type { SignRequest, SignRequestHandler, SignResponse } from './OIDFlowWebSocketTransport';
import type { OIDFlowProgressEvent } from '../types/OIDFlowTypes';
import type { CredentialNotificationEvent, OID4VCIFlowParams, OID4VCIFlowResult } from '../types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult } from '../types/OID4VPTypes';
import type { TrustEvaluators } from '../types';
import { WmpClient, WmpRpcError } from '../wmp/WmpClient';
import { logger } from '@/logger';

/** How long one step of the flow may take before startOID4VCIFlow gives up. */
const STEP_TIMEOUT_MS = 120_000;

/** WMP Core error code of a structured flow error. */
const ERR_FLOW_ERROR = -31006;

type IssuedCredential = NonNullable<OID4VCIFlowResult['credentials']>[number];

interface ResponseKey {
	privateKey: KeyLike;
	alg: string;
	enc: string;
}

interface VciFlow {
	flowId: string;
	waiter: {
		resolve: (r: OID4VCIFlowResult) => void;
		reject: (e: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null;
	offerConfigIds: string[];
	credentialIssuer?: string;
	selectedConfigId?: string;
	responseKey?: ResponseKey;
	decrypted: IssuedCredential[];
	credentialMetadata?: Record<string, unknown>;
	ended: boolean;
}

/** What the user consented to for one credential query; never sent to the engine. */
interface VpSelection {
	credentialId: string;
	credentialQueryId: string;
	credentialRaw: string;
	disclosedClaims: string[];
}

interface VpFlow {
	flowId: string;
	waiter: {
		resolve: (r: OID4VPFlowResult) => void;
		reject: (e: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null;
	/** The handle sent with select_credentials; the sign request must carry it back. */
	selectionHandle?: string;
	/** query_id -> the user's selection for it. */
	selections: Map<string, VpSelection>;
	ended: boolean;
}

/** How long reportNoMatchingCredentials waits for the engine to end the flow. */
const NO_MATCH_TIMEOUT_MS = 10_000;

export class OIDFlowWmpTransport extends OIDFlowWebSocketTransport {
	private readonly wmp: WmpClient;
	private wmpToken: string;
	private wmpOpening: Promise<void> | null = null;
	private readonly wmpTrust: TrustEvaluators;

	private readonly wmpSignHandlers = new Set<SignRequestHandler>();
	private readonly wmpProgressCallbacks = new Set<(event: OIDFlowProgressEvent) => void>();
	private readonly wmpErrorCallbacks = new Set<(error: Error) => void>();

	private readonly vciFlows = new Map<string, VciFlow>();
	/** The issuance flow to resume with provide_tx_code / authorize. */
	private currentVciFlowId: string | null = null;
	/** credential_notification flow id -> the issuance flow whose auth material it uses. */
	private readonly notificationParents = new Map<string, string>();

	private readonly vpFlows = new Map<string, VpFlow>();
	/** The presentation flow the next select_credentials / decline applies to. */
	private currentVpFlowId: string | null = null;

	constructor(wmpUrl: string, wsUrl: string, authToken: string, tenantId: string = 'default', trustEvaluators?: TrustEvaluators) {
		super(wsUrl, authToken, tenantId, trustEvaluators);
		this.wmpToken = authToken;
		this.wmpTrust = trustEvaluators ?? ({
			evaluateIssuerTrust: async () => ({ trusted: false }),
			evaluateVerifierTrust: async () => ({ trusted: false }),
		} as unknown as TrustEvaluators);
		this.wmp = new WmpClient(wmpUrl, () => this.wmpToken);
		this.wmp.onNotification((method, params) => this.handleNotification(method, params));
		this.wmp.setRequestHandler((method, params) => this.handleServerRequest(method, params));
		this.wmp.onStreamLost((err) => this.failAllFlows(err));
	}

	// ===== Registration: keep a copy so WMP can reach the same callbacks =====

	override onSignRequest(handler: SignRequestHandler): () => void {
		const off = super.onSignRequest(handler);
		this.wmpSignHandlers.add(handler);
		return () => {
			off();
			this.wmpSignHandlers.delete(handler);
		};
	}

	override onProgress(callback: (event: OIDFlowProgressEvent) => void): () => void {
		const off = super.onProgress(callback);
		this.wmpProgressCallbacks.add(callback);
		return () => {
			off();
			this.wmpProgressCallbacks.delete(callback);
		};
	}

	override onError(callback: (error: Error) => void): () => void {
		const off = super.onError(callback);
		this.wmpErrorCallbacks.add(callback);
		return () => {
			off();
			this.wmpErrorCallbacks.delete(callback);
		};
	}

	override updateAuthToken(token: string, tenantId?: string): void {
		super.updateAuthToken(token, tenantId);
		this.wmpToken = token;
	}

	// One engine session per user: a WebSocket session and a WMP session push
	// each other out ("superseded"). In WMP mode the WMP session is the
	// connection, and the inherited WebSocket is never opened. The inherited
	// disconnect() is kept: it only concerns the WebSocket, so the context
	// calling it (connect timeout, transport rebuild) does not end the WMP session.
	override async connect(): Promise<void> {
		await this.ensureSession();
	}

	override isConnected(): boolean {
		return this.wmp.hasSession() && this.wmp.isStreaming();
	}

	/** Ends the WMP session and fails any issuance still waiting (e.g. on logout). */
	async closeWmp(): Promise<void> {
		this.failAllFlows(new Error('Transport disconnected'));
		this.currentVciFlowId = null;
		await this.wmp.close();
	}

	// ===== OID4VCI over WMP =====

	override async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		// After the authorization redirect: the page reloaded, so this is a new
		// session; start a new flow that carries the code (the engine's flow start
		// accepts auth_code and code_verifier, as on the WebSocket).
		if (params.authorizationCode && params.credentialOffer) {
			return this.startVciFlow({
				offer: params.credentialOffer,
				redirect_uri: params.redirectUri,
				auth_code: params.authorizationCode,
				code_verifier: params.codeVerifier,
				client_attestation: params.clientAttestation,
				client_attestation_pop: params.clientAttestationPoP,
			});
		}

		if (params.credentialOfferUri || params.credentialOffer) {
			return this.startVciFlow({
				credential_offer_uri: params.credentialOfferUri,
				offer: params.credentialOffer,
				redirect_uri: params.redirectUri,
				client_attestation: params.clientAttestation,
				client_attestation_pop: params.clientAttestationPoP,
			});
		}

		if (params.preAuthorizedCode) {
			const flow = this.requireCurrentFlow();
			return this.actAndWait(flow, 'provide_tx_code', { tx_code: params.txCodeInput ?? '' });
		}

		if (params.authorizationCode) {
			const flow = this.requireCurrentFlow();
			return this.actAndWait(flow, 'authorize', {
				auth_code: params.authorizationCode,
				code_verifier: params.codeVerifier,
				state: params.state,
			});
		}

		if (params.holderBinding && params.credentialConfigurationId) {
			// The WebSocket's consent step has no WMP counterpart: the key proof is
			// requested by the engine through the sign sub-flow.
			return this.errorResult('UNSUPPORTED_STEP', 'holder binding is requested through the sign sub-flow over WMP');
		}

		throw new Error('Invalid OID4VCI flow params: no valid entry point or continuation');
	}

	override sendCredentialNotification(flowId: string, notificationId: string, event: CredentialNotificationEvent): void {
		if (!this.wmp.hasSession() || !this.wmp.hasCapability('credential_notification')) {
			logger.debug('[WMP] credential notification not sent: capability not negotiated');
			return;
		}
		const notifyFlowId = `cn-${crypto.randomUUID()}`;
		this.notificationParents.set(notifyFlowId, flowId);
		this.wmp.call('wmp.flow.start', {
			wmp: this.wmp.meta(),
			flow_type: 'credential_notification',
			flow_id: notifyFlowId,
			params: { issuance_flow_id: flowId, notification_id: notificationId, event },
		}).catch((e) => {
			this.notificationParents.delete(notifyFlowId);
			logger.warn('[WMP] credential notification refused', e instanceof WmpRpcError ? e.code : e);
		});
	}

	private async startVciFlow(start: Record<string, unknown>): Promise<OID4VCIFlowResult> {
		await this.ensureSession();

		const flowId = `vci-${crypto.randomUUID()}`;
		const flow: VciFlow = { flowId, waiter: null, offerConfigIds: [], decrypted: [], ended: false };
		this.vciFlows.set(flowId, flow);
		this.currentVciFlowId = flowId;

		const result = this.waitForStep(flow);
		try {
			await this.wmp.call('wmp.flow.start', {
				wmp: this.wmp.meta(),
				flow_type: 'oid4vci',
				flow_id: flowId,
				params: dropUndefined(start),
			});
		} catch (e) {
			this.endFlow(flow);
			return this.errorResult(rpcCode(e), e instanceof Error ? e.message : 'Flow start refused');
		}
		return result;
	}

	private async actAndWait(flow: VciFlow, action: string, params: Record<string, unknown>): Promise<OID4VCIFlowResult> {
		const result = this.waitForStep(flow);
		try {
			await this.wmp.call('wmp.flow.action', {
				wmp: this.wmp.meta(),
				flow_id: flow.flowId,
				action,
				params: dropUndefined(params),
			});
		} catch (e) {
			this.endFlow(flow);
			return this.errorResult(rpcCode(e), e instanceof Error ? e.message : `${action} refused`);
		}
		return result;
	}

	private requireCurrentFlow(): VciFlow {
		const flow = this.currentVciFlowId ? this.vciFlows.get(this.currentVciFlowId) : undefined;
		if (!flow || flow.ended) throw new Error('No issuance flow in progress');
		return flow;
	}

	private ensureSession(): Promise<void> {
		if (this.wmp.hasSession() && this.wmp.isStreaming()) return Promise.resolve();
		if (!this.wmpOpening) {
			this.wmpOpening = this.wmp
				.open({ oid4vci: {}, oid4vp: {}, flows: {}, credential_notification: {} })
				.finally(() => { this.wmpOpening = null; });
		}
		return this.wmpOpening;
	}
	/** Resolves at the next step that needs the app, or at the end of the flow. */
	private waitForStep(flow: VciFlow): Promise<OID4VCIFlowResult> {
		if (flow.waiter) {
			clearTimeout(flow.waiter.timer);
			flow.waiter.reject(new Error('Superseded by a newer request'));
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				flow.waiter = null;
				reject(new Error('Request timeout'));
			}, STEP_TIMEOUT_MS);
			flow.waiter = { resolve, reject, timer };
		});
	}

	private settle(flow: VciFlow, result: OID4VCIFlowResult): void {
		const w = flow.waiter;
		flow.waiter = null;
		if (!w) {
			logger.debug('[WMP] flow result with no caller waiting', { flowId: flow.flowId });
			return;
		}
		clearTimeout(w.timer);
		w.resolve(result);
	}

	private endFlow(flow: VciFlow): void {
		flow.ended = true;
		flow.responseKey = undefined;
		this.vciFlows.delete(flow.flowId);
		if (this.currentVciFlowId === flow.flowId) this.currentVciFlowId = null;
	}

	private failAllFlows(err: Error): void {
		Array.from(this.vciFlows.values()).forEach((flow) => {
			if (flow.waiter) {
				clearTimeout(flow.waiter.timer);
				flow.waiter.reject(err);
				flow.waiter = null;
			}
			this.endFlow(flow);
		});
		Array.from(this.vpFlows.values()).forEach((flow) => {
			if (flow.waiter) {
				clearTimeout(flow.waiter.timer);
				flow.waiter.reject(err);
				flow.waiter = null;
			}
			this.endVpFlow(flow);
		});
		Array.from(this.wmpErrorCallbacks).forEach((cb) => {
			try { cb(err); } catch (e) { logger.error('[WMP] error callback failed', e); }
		});
	}

	private baseResult(flow: VciFlow): OID4VCIFlowResult {
		const r: OID4VCIFlowResult = { success: true, flowId: flow.flowId };
		if (flow.credentialIssuer) r.credentialIssuerIdentifier = flow.credentialIssuer;
		// The engine skips awaiting_offer_acceptance when the offer names a single
		// credential (it selects it itself), so the configuration falls back to the
		// offer's first one. Without it the stored credential has no configuration
		// id, and its display (name, card image) cannot be found.
		const configId = flow.selectedConfigId ?? flow.offerConfigIds[0];
		if (configId) r.selectedCredentialConfigurationId = configId;
		return r;
	}

	private errorResult(code: string, message: string): OID4VCIFlowResult {
		return { success: false, error: { code, message } };
	}

	// ===== Messages from the engine =====

	private handleNotification(method: string, params: Record<string, unknown>): void {
		const flowId = params.flow_id as string | undefined;

		if (method === 'wmp.message.deliver') {
			logger.debug('[WMP] message delivered', { type: params.message_type });
			return;
		}

		if (flowId && this.notificationParents.has(flowId)) {
			if (method === 'wmp.flow.complete' || method === 'wmp.flow.error') {
				logger.debug('[WMP] credential notification', { outcome: method, data: method === 'wmp.flow.error' ? params.data : undefined });
				this.notificationParents.delete(flowId);
			}
			return;
		}

		const vpFlow = flowId ? this.vpFlows.get(flowId) : undefined;
		if (vpFlow) {
			this.handleVpNotification(vpFlow, method, params);
			return;
		}

		const flow = flowId ? this.vciFlows.get(flowId) : undefined;
		if (!flow) return; // a sub-flow of ours, or a replay of a flow that already ended

		switch (method) {
			case 'wmp.flow.progress':
				this.handleProgress(flow, params.step as string, (params.payload ?? {}) as Record<string, unknown>);
				break;
			case 'wmp.flow.complete':
				this.handleComplete(flow, (params.result ?? {}) as Record<string, unknown>);
				break;
			case 'wmp.flow.error': {
				const data = params.data as Record<string, unknown> | undefined;
				const reason = typeof data?.reason === 'string' ? data.reason : undefined;
				this.endFlow(flow);
				this.settle(flow, this.errorResult(
					reason ? reason.toUpperCase() : `WMP_${params.code}`,
					(params.message as string) || 'Issuance failed',
				));
				break;
			}
		}
	}

	private handleProgress(flow: VciFlow, step: string, payload: Record<string, unknown>): void {
		this.emitWmpProgress({ flowId: flow.flowId, stage: step, payload });

		switch (step) {
			case 'parsing_offer': {
				const offer = payload.offer as { credential_issuer?: string; credential_configuration_ids?: string[] } | undefined;
				if (offer?.credential_issuer) flow.credentialIssuer = offer.credential_issuer;
				if (Array.isArray(offer?.credential_configuration_ids)) flow.offerConfigIds = offer.credential_configuration_ids;
				break;
			}
			case 'metadata_fetched': {
				const md = payload.issuer_metadata as { credential_issuer?: string } | undefined;
				if (md?.credential_issuer) flow.credentialIssuer = md.credential_issuer;
				break;
			}
			case 'evaluating_trust':
				if (payload.trust_evaluation_required) {
					this.answerTrustEvaluation(flow.flowId, payload).catch((e) => logger.error('[WMP] trust evaluation failed', e));
				}
				break;
			case 'awaiting_offer_acceptance': {
				// The WebSocket flow takes the first configuration without asking; do the same.
				const index = 0;
				flow.selectedConfigId = flow.offerConfigIds[index] ?? flow.selectedConfigId;
				this.wmp.call('wmp.flow.action', {
					wmp: this.wmp.meta(),
					flow_id: flow.flowId,
					action: 'accept_offer',
					params: { selected_indices: [index], consent: true },
				}).catch((e) => {
					this.endFlow(flow);
					this.settle(flow, this.errorResult(rpcCode(e), 'accept_offer refused'));
				});
				break;
			}
			case 'awaiting_tx_code': {
				const spec = (payload.tx_code ?? {}) as { input_mode?: string; length?: number; description?: string };
				const result = this.baseResult(flow);
				// The engine keeps the pre-authorized code; the app only needs a
				// truthy value to ask for the PIN and hand it back.
				result.preAuthorizedCode = `wmp:${flow.flowId}`;
				result.txCode = {
					inputMode: spec.input_mode,
					length: spec.length,
					description: spec.description ?? (payload.tx_code_description as string | undefined),
				};
				this.settle(flow, result);
				break;
			}
			case 'authorization_pending': {
				// The engine also reports this step when it resumes with a code
				// ("Resuming flow with authorization code"): only a URL means a redirect.
				if (!payload.authorization_url) break;
				const result = this.baseResult(flow);
				result.authorizationRequired = true;
				result.authorizationUrl = payload.authorization_url as string;
				result.codeVerifier = payload.code_verifier as string | undefined;
				result.issuerState = payload.state as string | undefined;
				if (payload.credential_offer) {
					result.credentialOffer = payload.credential_offer as OID4VCIFlowResult['credentialOffer'];
					if (!result.credentialIssuerIdentifier && result.credentialOffer?.credential_issuer) {
						result.credentialIssuerIdentifier = result.credentialOffer.credential_issuer;
					}
					if (!result.selectedCredentialConfigurationId && result.credentialOffer?.credential_configuration_ids?.length) {
						result.selectedCredentialConfigurationId = result.credentialOffer.credential_configuration_ids[0];
					}
				}
				// The page is about to leave for the issuer and the code comes back to
				// a new flow, so this one is ended rather than left to time out.
				this.endFlow(flow);
				this.wmp.call('wmp.flow.cancel', { wmp: this.wmp.meta(), flow_id: flow.flowId, reason: 'authorization redirect' })
					.catch(() => {});
				this.settle(flow, result);
				break;
			}
		}
	}
	private handleComplete(flow: VciFlow, r: Record<string, unknown>): void {
		const result = this.baseResult(flow);
		const wire = (Array.isArray(r.credentials) ? r.credentials : []) as Array<Record<string, unknown>>;

		if (r.credential_response_encrypted === true) {
			// The engine relayed the issuer's JWE unread; the credentials are the
			// ones decrypted here, in order (3.1.4).
			if (wire.length !== flow.decrypted.length) {
				this.endFlow(flow);
				this.settle(flow, this.errorResult('CREDENTIAL_COUNT_MISMATCH',
					`engine reported ${wire.length} credential(s), ${flow.decrypted.length} decrypted`));
				return;
			}
			result.credentials = wire.map((c, i) => ({
				format: (c.format as string) ?? flow.decrypted[i].format,
				vct: (c.vct as string) ?? flow.decrypted[i].vct,
				credential: flow.decrypted[i].credential,
				notification_id: flow.decrypted[i].notification_id,
			}));
			if (flow.credentialMetadata) result.credentialMetadata = flow.credentialMetadata;
		} else {
			result.credentials = wire
				.filter((c) => typeof c.credential === 'string')
				.map((c) => ({
					format: c.format as string | undefined,
					vct: c.vct as string | undefined,
					credential: c.credential as string,
					notification_id: c.notification_id as string | undefined,
				}));
			// Display members only (3.1.4.1); anything else is dropped by the engine.
			if (r.credential_metadata && typeof r.credential_metadata === 'object') {
				result.credentialMetadata = r.credential_metadata as Record<string, unknown>;
			}
		}

		if (Array.isArray(r.redacted_members) && r.redacted_members.length) {
			// A replayed completion (3.1.4.2): the secret members are not recoverable.
			logger.warn('[WMP] completion was replayed; withheld members are not recoverable', r.redacted_members);
		}

		this.endFlow(flow);
		this.settle(flow, result);
	}

	/**
	 * The engine asks the wallet to decide trust only when it has no PDP. Same
	 * evaluators as the WebSocket transport; anything missing or failing is "not
	 * trusted" (fail closed).
	 */
	private async answerTrustEvaluation(flowId: string, payload: Record<string, unknown>): Promise<void> {
		const req = payload.request as {
			subject_id?: string;
			subject_type?: string;
			key_material?: { type: string; x5c?: string[]; jwk?: unknown };
			context?: Record<string, unknown>;
		} | undefined;

		let trust: { trusted: boolean; framework?: string; reason?: string } = { trusted: false, reason: 'Missing subject_id' };
		if (req?.subject_id) {
			try {
				let r: { trusted: boolean; metadata?: Record<string, unknown> } | null = null;
				if (req.subject_type === 'credential_issuer') {
					r = await this.wmpTrust.evaluateIssuerTrust({
						issuerId: req.subject_id,
						keyMaterial: req.key_material ? {
							type: req.key_material.type as 'jwk' | 'x5c',
							key: req.key_material.x5c ?? req.key_material.jwk,
						} : undefined,
						context: req.context,
					});
				} else if (req.subject_type === 'credential_verifier') {
					const scheme = (req.context?.client_id_scheme as string) || 'x509_san_dns';
					const clientId = req.subject_id;
					const identifier = scheme === 'x509_san_dns' && clientId.startsWith('x509_san_dns:')
						? clientId.slice('x509_san_dns:'.length)
						: clientId;
					r = await this.wmpTrust.evaluateVerifierTrust({
						clientIdScheme: { scheme: scheme as 'x509_san_dns' | 'did' | 'https' | 'pre-registered', clientId, identifier },
						keyMaterial: req.key_material
							? { type: req.key_material.type as 'jwk' | 'x5c' | 'kid', key: req.key_material.x5c ?? req.key_material.jwk }
							: { type: 'kid' as const, key: '' },
						responseUri: req.context?.response_uri as string | undefined,
					});
				}
				trust = r
					? { trusted: r.trusted ?? false, framework: r.metadata?.framework as string | undefined, reason: r.metadata?.reason as string | undefined }
					: { trusted: false, reason: `Unknown subject_type ${req.subject_type}` };
			} catch (e) {
				trust = { trusted: false, reason: e instanceof Error ? e.message : 'Unknown error' };
			}
		}
		await this.wmp.call('wmp.flow.action', {
			wmp: this.wmp.meta(),
			flow_id: flowId,
			action: 'trust_result',
			params: dropUndefined(trust),
		});
	}

	// ===== OID4VP over WMP (3.2) =====

	override async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
		if (params.selectedCredentials) {
			const flow = this.requireCurrentVpFlow();
			if (!params.selectedCredentials.length) {
				return this.vpActAndWait(flow, 'select_credentials', { consent: false });
			}
			// Kept here, keyed by the handle: the engine learns only which of the
			// verifier's query ids were consented to (3.2.3.1).
			const handle = newSelectionHandle();
			flow.selectionHandle = handle;
			flow.selections = new Map();
			for (const c of params.selectedCredentials) {
				if (flow.selections.has(c.credentialQueryId)) {
					throw new Error(`more than one credential selected for query ${c.credentialQueryId}`);
				}
				flow.selections.set(c.credentialQueryId, {
					credentialId: c.walletCredentialRef,
					credentialQueryId: c.credentialQueryId,
					credentialRaw: c.credentialRaw,
					disclosedClaims: c.disclosedClaims ?? [],
				});
			}
			return this.vpActAndWait(flow, 'select_credentials', {
				consent: true,
				selections: Array.from(flow.selections.keys()).map((id) => ({ query_id: id, selection_handle: handle })),
			});
		}

		if (params.requestUriRef) {
			return this.startVpFlow({ request_uri_ref: params.requestUriRef, client_id: params.clientId });
		}

		throw new Error('Invalid OID4VP flow params: no valid entry point or continuation');
	}

	/**
	 * Local matching found nothing: decline (consent false), which the engine
	 * reports to the verifier as access_denied, the same answer as any refusal.
	 * The result carries the code the app looks for, and the verifier's redirect.
	 */
	override async reportNoMatchingCredentials(): Promise<OID4VPFlowResult | null> {
		const flow = this.currentVpFlowId ? this.vpFlows.get(this.currentVpFlowId) : undefined;
		if (!flow || flow.ended) return null;
		try {
			const r = await this.vpActAndWait(flow, 'select_credentials', { consent: false }, NO_MATCH_TIMEOUT_MS);
			if (r.success) return r;
			return {
				success: false,
				error: { code: 'NO_MATCHING_CREDENTIALS', message: r.error?.message ?? 'No matching credentials', details: r.error?.details },
			};
		} catch (err) {
			logger.warn('[WMP] no answer to the decline', err instanceof Error ? err.message : err);
			return null;
		}
	}

	private async startVpFlow(start: Record<string, unknown>): Promise<OID4VPFlowResult> {
		await this.ensureSession();

		const flowId = `vp-${crypto.randomUUID()}`;
		const flow: VpFlow = { flowId, waiter: null, selections: new Map(), ended: false };
		this.vpFlows.set(flowId, flow);
		this.currentVpFlowId = flowId;

		const result = this.waitForVp(flow);
		try {
			await this.wmp.call('wmp.flow.start', {
				wmp: this.wmp.meta(),
				flow_type: 'oid4vp',
				flow_id: flowId,
				params: dropUndefined(start),
			});
		} catch (e) {
			this.endVpFlow(flow);
			return { success: false, error: { code: rpcCode(e), message: e instanceof Error ? e.message : 'Flow start refused' } };
		}
		return result;
	}

	private async vpActAndWait(flow: VpFlow, action: string, params: Record<string, unknown>, timeoutMs = STEP_TIMEOUT_MS): Promise<OID4VPFlowResult> {
		const result = this.waitForVp(flow, timeoutMs);
		try {
			await this.wmp.call('wmp.flow.action', { wmp: this.wmp.meta(), flow_id: flow.flowId, action, params });
		} catch (e) {
			// A refused select_credentials also ends the flow with a terminal
			// wmp.flow.error (3.2.3.1); the call's own error answers first.
			this.endVpFlow(flow);
			if (flow.waiter) {
				clearTimeout(flow.waiter.timer);
				flow.waiter = null;
			}
			return { success: false, error: { code: rpcCode(e), message: e instanceof Error ? e.message : `${action} refused` } };
		}
		return result;
	}

	private requireCurrentVpFlow(): VpFlow {
		const flow = this.currentVpFlowId ? this.vpFlows.get(this.currentVpFlowId) : undefined;
		if (!flow || flow.ended) throw new Error('No presentation flow in progress');
		return flow;
	}

	private waitForVp(flow: VpFlow, timeoutMs = STEP_TIMEOUT_MS): Promise<OID4VPFlowResult> {
		if (flow.waiter) {
			clearTimeout(flow.waiter.timer);
			flow.waiter.reject(new Error('Superseded by a newer request'));
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				flow.waiter = null;
				reject(new Error('Request timeout'));
			}, timeoutMs);
			flow.waiter = { resolve, reject, timer };
		});
	}

	private settleVp(flow: VpFlow, result: OID4VPFlowResult): void {
		const w = flow.waiter;
		flow.waiter = null;
		if (!w) {
			logger.debug('[WMP] presentation result with no caller waiting', { flowId: flow.flowId });
			return;
		}
		clearTimeout(w.timer);
		w.resolve(result);
	}

	private endVpFlow(flow: VpFlow): void {
		flow.ended = true;
		flow.selections.clear(); // the raw credentials are not kept past the flow
		flow.selectionHandle = undefined;
		this.vpFlows.delete(flow.flowId);
		if (this.currentVpFlowId === flow.flowId) this.currentVpFlowId = null;
	}

	private handleVpNotification(flow: VpFlow, method: string, params: Record<string, unknown>): void {
		switch (method) {
			case 'wmp.flow.progress': {
				const step = params.step as string;
				const payload = (params.payload ?? {}) as Record<string, unknown>;
				this.emitWmpProgress({ flowId: flow.flowId, stage: step, payload });
				if (step === 'evaluating_trust' && payload.trust_evaluation_required) {
					this.answerTrustEvaluation(flow.flowId, payload).catch((e) => logger.error('[WMP] trust evaluation failed', e));
				} else if (step === 'awaiting_consent') {
					const result: OID4VPFlowResult = { success: true };
					if (payload.dcql_query) result.dcqlQuery = payload.dcql_query as DcqlQuery.Input;
					if (payload.verifier_info) result.verifierInfo = mapVerifierInfo(payload.verifier_info as Record<string, unknown>);
					const purpose = (payload.dcql_query as { credential_sets?: Array<{ purpose?: string }> } | undefined)?.credential_sets?.[0]?.purpose;
					if (purpose && result.verifierInfo) result.verifierInfo.purpose = purpose;
					this.settleVp(flow, result);
				}
				break;
			}
			case 'wmp.flow.complete': {
				const r = (params.result ?? {}) as Record<string, unknown>;
				const result: OID4VPFlowResult = { success: true };
				if (typeof r.redirect_uri === 'string') result.redirectUri = r.redirect_uri;
				if (r.response_data !== undefined) result.responseData = r.response_data;
				this.endVpFlow(flow);
				this.settleVp(flow, result);
				break;
			}
			case 'wmp.flow.error': {
				const data = params.data as Record<string, unknown> | undefined;
				const reason = typeof data?.reason === 'string' ? data.reason : undefined;
				this.endVpFlow(flow);
				this.settleVp(flow, {
					success: false,
					error: {
						code: reason ? reason.toUpperCase() : `WMP_${params.code}`,
						message: (params.message as string) || 'Presentation failed',
						...(data ? { details: data } : {}),
					},
				});
				break;
			}
		}
	}

	/**
	 * The sign_presentation sub-flow (3.2.5). The engine says which consented
	 * queries to answer and hands the selection handle back; everything else
	 * (which credential, which claims) comes from what the user consented to.
	 */
	private async signPresentation(childId: string, parentId: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
		const flow = this.vpFlows.get(parentId);
		if (!flow || !flow.selectionHandle) throw new Error('no consent for this presentation');
		if (p.selection_handle !== flow.selectionHandle) throw new Error('selection_handle is missing or unknown');
		if (Array.isArray(p.transaction_data) && p.transaction_data.length) {
			// Not offered as a capability, so the engine should not send it; never present without binding it.
			throw new Error('transaction_data is not supported by this wallet');
		}

		const asked = (Array.isArray(p.credentials_to_include) ? p.credentials_to_include : []) as Array<{ credential_query_id?: string }>;
		if (!asked.length) throw new Error('no credential query to answer');
		const seen = new Set<string>();
		const credentialsToInclude = asked.map((a) => {
			const id = a.credential_query_id ?? '';
			const s = flow.selections.get(id);
			if (!s || seen.has(id)) throw new Error(`credential query ${id} was not consented to`);
			seen.add(id);
			return { credentialId: s.credentialId, credentialQueryId: s.credentialQueryId, disclosedClaims: s.disclosedClaims, credentialRaw: s.credentialRaw };
		});

		const response = await this.callSignHandlers({
			flowId: parentId,
			messageId: childId,
			action: 'sign_presentation',
			params: {
				audience: p.audience as string | undefined,
				nonce: p.nonce as string | undefined,
				responseUri: p.response_uri as string | undefined,
				verifierJwkThumbprint: p.verifier_jwk_thumbprint as string | undefined,
				credentialsToInclude,
			},
		});
		if (!response.vpToken) throw new Error('the sign handler returned no vp_token');

		// The handler returns the DCQL vp_token object as JSON text; send the object (3.2.4).
		let vpToken: unknown = response.vpToken;
		try {
			const parsed = JSON.parse(response.vpToken);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) vpToken = parsed;
		} catch {
			// a plain token string
		}

		// direct_post.jwt (7.7): the wallet encrypts the response to the verifier itself.
		const enc = p.response_encryption as { jwk?: JWK; alg?: string; enc?: string } | undefined;
		if (enc?.jwk && enc.alg && enc.enc) {
			return { response_jwe: await encryptAuthorizationResponse(vpToken, p.state as string | undefined, enc as { jwk: JWK; alg: string; enc: string }) };
		}
		return { vp_token: vpToken };
	}
	// ===== Sign sub-flows (3.1.5) =====

	private async handleServerRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (method !== 'wmp.flow.start' || params.flow_type !== 'sign') {
			throw new WmpRpcError(-32601, 'Method not found');
		}
		const childId = params.flow_id as string;
		const signParams = (params.params ?? {}) as Record<string, unknown>;
		// Answer the start first; the result follows as wmp.flow.complete.
		setTimeout(() => { this.runSign(childId, signParams).catch(() => {}); }, 0);
		return { wmp: this.wmp.meta(), flow_id: childId, flow_type: 'sign' };
	}

	private async runSign(childId: string, p: Record<string, unknown>): Promise<void> {
		const action = p.action as string;
		const parentId = p.parent_flow_id as string;
		try {
			let result: Record<string, unknown>;
			switch (action) {
				case 'decrypt_credential_response':
					result = await this.decryptCredentialResponse(parentId, p);
					break;
				case 'generate_proof':
					result = await this.generateProof(childId, parentId, p);
					break;
				case 'sign_client_auth':
					result = toWireSignResponse(await this.callSignHandlers(this.toSignRequest(childId, this.authFlowOf(parentId), action, p)));
					break;
				case 'sign_presentation':
					result = await this.signPresentation(childId, parentId, p);
					break;
				default:
					throw new Error(`sign action ${action} is not supported over WMP yet`);
			}
			await this.wmp.notify('wmp.flow.complete', { wmp: this.wmp.meta(), flow_id: childId, result });
		} catch (e) {
			// A failure, not a refusal (data.reason "rejected" is reserved for a user decline).
			logger.warn('[WMP] sign sub-flow failed', { action, error: e instanceof Error ? e.message : String(e) });
			await this.wmp.notify('wmp.flow.error', {
				wmp: this.wmp.meta(),
				flow_id: childId,
				code: ERR_FLOW_ERROR,
				message: 'sign sub-flow failed',
			}).catch(() => {});
		}
	}

	/** The issuance flow whose client auth material (DPoP key, WIA) a sub-flow uses. */
	private authFlowOf(parentId: string): string {
		return this.notificationParents.get(parentId) ?? parentId;
	}

	private async generateProof(childId: string, parentId: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
		const out: Record<string, unknown> = {};
		const cre = p.credential_response_encryption as { alg?: string; enc?: string; required?: boolean } | undefined;
		if (cre?.alg && cre?.enc) {
			const flow = this.vciFlows.get(parentId);
			if (!flow) throw new Error('no issuance flow for the encryption key');
			const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
			flow.responseKey = { privateKey, alg: cre.alg, enc: cre.enc };
			out.credential_response_encryption_jwk = { ...(await exportJWK(publicKey)), use: 'enc', alg: cre.alg };
		}
		// A request with neither proof_type nor proof_types_supported asks for the key alone.
		if (p.proof_type || p.proof_types_supported) {
			const response = await this.callSignHandlers(this.toSignRequest(childId, parentId, 'generate_proof', p));
			Object.assign(out, toWireSignResponse(response));
		}
		return out;
	}

	private async decryptCredentialResponse(parentId: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
		const flow = this.vciFlows.get(parentId);
		const key = flow?.responseKey;
		if (!flow || !key) throw new Error('no response-encryption key for this flow');

		const { plaintext } = await compactDecrypt(p.jwe as string, key.privateKey, {
			keyManagementAlgorithms: [key.alg],
			contentEncryptionAlgorithms: [key.enc],
		});
		const resp = JSON.parse(new TextDecoder().decode(plaintext)) as {
			credentials?: Array<{ credential: string }>;
			credential?: string;
			notification_id?: string;
			transaction_id?: string;
			interval?: number;
			credential_metadata?: Record<string, unknown>;
		};

		if (resp.transaction_id) {
			return dropUndefined({ transaction_id: resp.transaction_id, interval: resp.interval });
		}
		const creds = resp.credentials ?? (resp.credential ? [{ credential: resp.credential }] : []);
		if (!creds.length) throw new Error('decrypted response carries no credential');
		for (const c of creds) {
			flow.decrypted.push({ credential: c.credential, notification_id: resp.notification_id });
		}
		if (resp.credential_metadata) {
			flow.credentialMetadata = { ...(flow.credentialMetadata ?? {}), ...resp.credential_metadata };
		}
		return { credential_count: creds.length };
	}

	private toSignRequest(childId: string, flowId: string, action: string, raw: Record<string, unknown>): SignRequest {
		return {
			flowId,
			messageId: childId,
			action: action as SignRequest['action'],
			params: {
				audience: raw.audience as string | undefined,
				issuer: raw.issuer as string | undefined,
				nonce: raw.nonce as string | undefined,
				proofType: raw.proof_type as string | undefined,
				proofTypesSupported: raw.proof_types_supported as SignRequest['params']['proofTypesSupported'],
				count: raw.count as number | undefined,
				htm: raw.htm as string | undefined,
				htu: raw.htu as string | undefined,
				dpopNonce: raw.dpop_nonce as string | undefined,
				attestationChallenge: raw.attestation_challenge as string | undefined,
				ath: raw.ath as string | undefined,
				keyId: raw.key_id as string | undefined,
			},
		};
	}

	private async callSignHandlers(request: SignRequest): Promise<SignResponse> {
		if (this.wmpSignHandlers.size === 0) throw new Error('No sign handler available');
		let lastError: Error | null = null;
		for (const handler of Array.from(this.wmpSignHandlers)) {
			try {
				return await handler(request);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				logger.warn('[WMP] sign handler failed:', lastError.message);
			}
		}
		throw lastError ?? new Error('Sign operation failed');
	}

	private emitWmpProgress(event: OIDFlowProgressEvent): void {
		Array.from(this.wmpProgressCallbacks).forEach((cb) => {
			try { cb(event); } catch (e) { logger.error('[WMP] progress callback failed', e); }
		});
	}
}

/** The sign result members, with the engine's names (as on the WebSocket). */
function toWireSignResponse(r: SignResponse): Record<string, unknown> {
	return dropUndefined({
		proof_jwt: r.proofJwt,
		proofs: r.proofs,
		client_attestation: r.clientAttestation,
		client_attestation_pop: r.clientAttestationPoP,
		dpop_key_id: r.dpopKeyId,
		dpop_proof: r.dpopProof,
	});
}

/** A per-flow selection handle: 32 base64url characters, 192 random bits (3.3.2 asks for 22 or more). */
function newSelectionHandle(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	let s = '';
	bytes.forEach((b) => { s += String.fromCharCode(b); });
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The JARM response of direct_post.jwt: {vp_token, state} encrypted to the verifier's key. */
async function encryptAuthorizationResponse(vpToken: unknown, state: string | undefined, enc: { jwk: JWK; alg: string; enc: string }): Promise<string> {
	const key = await importJWK(enc.jwk, enc.alg);
	const header: Record<string, string> = { alg: enc.alg, enc: enc.enc };
	if (typeof enc.jwk.kid === 'string' && enc.jwk.kid) header.kid = enc.jwk.kid;
	const payload = new TextEncoder().encode(JSON.stringify(dropUndefined({ vp_token: vpToken, state })));
	return new CompactEncrypt(payload).setProtectedHeader(header as { alg: string; enc: string }).encrypt(key);
}

function dropUndefined<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

function rpcCode(e: unknown): string {
	if (e instanceof WmpRpcError) {
		const reason = (e.data as { reason?: string } | undefined)?.reason;
		return reason ? reason.toUpperCase() : `WMP_${e.code}`;
	}
	return 'WMP_ERROR';
}