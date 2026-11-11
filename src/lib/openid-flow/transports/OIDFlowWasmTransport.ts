/**
 * WASM Transport: OpenID4VCI issuance (authorization-code grant) and
 * OpenID4VP presentation on the in-browser engine (siros-wallet-core
 * engine-adapter-wasm).
 *
 * The engine runs in the page and speaks WMP to this transport through
 * engine.request(); it reaches out through callbacks:
 *   fetch          -> the backend's /proxy (wasmPorts.createProxyFetch)
 *   pdp.evaluate   -> the issuer / verifier trust evaluators, fail closed (createTrustPdp)
 *   kv             -> sessionStorage, the authorization stash (createStorageKv)
 *   host.signingKey-> a fresh WSCD key; its public JWK (with kid) goes in the proof
 *   host.sign      -> the WSCD signs the proof the engine built (raw ES256)
 *   host.dpopProof / host.attestation -> the app's sign handler (sign_client_auth),
 *                     when one is registered; otherwise the engine's own DPoP key
 *   host.openAuthorization -> resolves the app's call with the authorization URL;
 *                     the app navigates (OpenIDFlowCallback). In a presentation,
 *                     the verifier's redirect after the response.
 *   host.match     -> the app's credential selection (see below)
 *   host.consent   -> yes, for exactly what the user selected
 *   host.vp        -> the app's sign handler (sign_presentation), built from the
 *                     user's selection kept here, never from the engine's ask alone
 *   onNotification -> wmp.flow.progress / complete / error
 *
 * How the app's calls map onto one engine flow:
 *   startOID4VCIFlow({credentialOfferUri|credentialOffer, redirectUri})
 *       -> wmp.flow.start oid4vci; resolves with authorizationUrl + codeVerifier +
 *          issuerState when the engine opens the authorization, or with the
 *          credentials if the flow completes without one.
 *   (redirect; the page reloads; a new transport and a new engine session)
 *   startOID4VCIFlow({authorizationCode, ...})
 *       -> wmp.flow.action authorization_complete on the SAME flow id, read back
 *          from sessionStorage; the engine restores its stash from the kv.
 *
 * Presentation, one engine flow:
 *   startOID4VPFlow({requestUriRef, clientId})
 *       -> wmp.flow.start oid4vp. The engine fetches and verifies the request,
 *          asks the PDP about the verifier, then asks host.match; the call
 *          resolves there with the DCQL query and the verifier, while the
 *          match ask stays open for the user's choice.
 *   startOID4VPFlow({selectedCredentials})
 *       -> answers the open match ask; the engine vets the selection against
 *          the query, asks consent and the VP token, submits the response, and
 *          the call resolves on completion (with the verifier's redirect).
 *   reportNoMatchingCredentials()
 *       -> answers the match ask with nothing: the engine tells the verifier
 *          access_denied, the same answer as a decline.
 *   A match ask nobody answers (the user left the screen) is answered with
 *   nothing after STEP_TIMEOUT_MS, so the verifier is not left waiting.
 *
 * Not supported here: a pre-authorized offer that needs a transaction code,
 * deferred issuance, presentations with transaction data, the Digital
 * Credentials API. Each answers with a clear error.
 */

import { OIDFlowWebSocketTransport } from './OIDFlowWebSocketTransport';
import type { SignRequest, SignRequestHandler, SignResponse } from './OIDFlowWebSocketTransport';
import type { OIDFlowProgressEvent, OIDFlowRequest, OIDFlowResponse } from '../types/OIDFlowTypes';
import type { CredentialNotificationEvent, OID4VCIFlowParams, OID4VCIFlowResult } from '../types/OID4VCITypes';
import type { OID4VPFlowParams, OID4VPFlowResult, OID4VPSelectedCredential, OID4VPVerifierInfo } from '../types/OID4VPTypes';
import type { DcqlQuery } from 'dcql';
import type { TrustEvaluators } from '../types';
import type { IWscdManagerClient } from '@/lib/wscd-manager';
import {
	createWasmEngine,
	isWmpEngineError,
	toPlain,
	wmpCall,
	type EngineAttestationParams,
	type EngineDpopProofParams,
	type EngineSignParams,
	type EngineSigningKeyParams,
	type EngineKeyValue,
	type EngineMatchParams,
	type EngineMatchResult,
	type EngineConsentParams,
	type EngineVerifierInfo,
	type EngineVpParams,
	type EngineVpResult,
	type WasmEngine,
	type WasmEngineConfig,
} from '../wasm/WasmEngine';
import { createProxyFetch, createStorageKv, createTrustPdp } from '../wasm/wasmPorts';
import { logger } from '@/logger';

/** How long one step (start to redirect, or resume to credential) may take. */
const STEP_TIMEOUT_MS = 3 * 60_000;
/** The flow id across the redirect: same tab, so sessionStorage. */
export const PENDING_AUTHORIZATION_KEY = 'wasm_oid4vci_pending_authorization';
/**
 * How long openAuthorization waits for the authorization_required notification
 * (the engine delivers notifications asynchronously, so it may arrive after the call).
 */
const AUTHORIZATION_ANNOUNCE_TIMEOUT_MS = 2_000;
/** The engine's authorization stash in its kv (engine-core oid4vci stash_key). */
const ENGINE_STASH_KEY = (flowId: string) => `oid4vci:auth-code:${flowId}`;
/** A pending authorization older than this is not resumed. */
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
/** How long reportNoMatchingCredentials waits for the engine to end the flow. */
const NO_MATCH_TIMEOUT_MS = 10_000;

export interface OIDFlowWasmTransportOptions {
	backendUrl: string;
	tenantId: string;
	/** A valid backend access token (refreshed when expired). */
	getAuthToken: () => Promise<string>;
	trustEvaluators: TrustEvaluators;
	/** The WSCD manager client; its keys sign the proofs. */
	getWscd: () => IWscdManagerClient | null;
	/** Defaults to window.sessionStorage. */
	storage?: Storage;
	/** The largest credential batch to ask for (default 1). */
	maxBatchSize?: number;
	/**
	 * The client_id the issuer's authorization server registered for this wallet
	 * (the backend's issuer record), or undefined for an unregistered client.
	 */
	getRegisteredClientId?: (credentialIssuer: string) => Promise<string | undefined>;
	/** For tests: builds the engine instead of loading the .wasm. */
	engineFactory?: (config: WasmEngineConfig) => Promise<WasmEngine>;
}

interface PendingAuthorization {
	flowId: string;
	state: string;
	credentialIssuer?: string;
	configurationId?: string;
	/** The configuration's credential format, from the issuer metadata. */
	format?: string;
	savedAt: number;
}

interface VciFlow {
	flowId: string;
	credentialIssuer?: string;
	configurationIds: string[];
	/** From the authorization_required progress step. */
	authorization?: { url: string; state: string; codeVerifier: string };
	/** Set while openAuthorization waits for that step. */
	onAuthorization?: () => void;
	/** The kid of the key the last signingKey answer named. */
	lastKid?: string;
	/** The credential format (the engine's completion does not carry it). */
	format?: string;
	transactionId?: string;
	waiter: {
		resolve: (r: OID4VCIFlowResult) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null;
	ended: boolean;
}

type IssuedCredential = NonNullable<OID4VCIFlowResult['credentials']>[number];

/** What the user selected for one credential query; the vp ask is checked against it. */
interface VpChoice {
	credentialId: string;
	credentialQueryId: string;
	credentialRaw: string;
	disclosedClaims: string[];
}

interface VpFlow {
	flowId: string;
	/** The app's pending call (the match step, then the completion). */
	waiter: {
		resolve: (r: OID4VPFlowResult) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null;
	/** The engine's open match ask. */
	matchAnswer?: (answer: EngineMatchResult) => void;
	matchTimer?: ReturnType<typeof setTimeout>;
	/** Set with the answer; the vp ask must carry it back. */
	selectionHandle?: string;
	/** query id -> the user's choice. */
	choices: Map<string, VpChoice>;
	/** The verifier's redirect after the response (via openAuthorization). */
	redirectUri?: string;
	/** The match was answered with nothing because nothing matched. */
	noMatch?: boolean;
	ended: boolean;
}

export class OIDFlowWasmTransport extends OIDFlowWebSocketTransport {
	private readonly wasmOpts: OIDFlowWasmTransportOptions;
	private readonly wasmStorage: Storage;
	private enginePromise: Promise<WasmEngine> | null = null;
	private proxyFetchFn: WasmEngineConfig['fetch'] | null = null;
	private kvStore: EngineKeyValue | null = null;
	private sessionPromise: Promise<string> | null = null;
	private wasmConnected = false;

	private readonly wasmSignHandlers = new Set<SignRequestHandler>();
	private readonly wasmProgressCallbacks = new Set<(event: OIDFlowProgressEvent) => void>();
	private readonly wasmErrorCallbacks = new Set<(error: Error) => void>();

	private readonly vciFlows = new Map<string, VciFlow>();
	private readonly vpFlows = new Map<string, VpFlow>();
	/** The presentation the next selection (or no-match report) answers. */
	private currentVpFlowId: string | null = null;

	constructor(opts: OIDFlowWasmTransportOptions) {
		// The base class is only used for its handler registry and type: no
		// WebSocket is ever opened.
		super('', '', opts.tenantId, opts.trustEvaluators);
		this.wasmOpts = opts;
		this.wasmStorage = opts.storage ?? window.sessionStorage;
	}

	// ===== Registration (keep a copy: the base class keeps its own private) =====

	override onSignRequest(handler: SignRequestHandler): () => void {
		const off = super.onSignRequest(handler);
		this.wasmSignHandlers.add(handler);
		return () => {
			off();
			this.wasmSignHandlers.delete(handler);
		};
	}

	override onProgress(callback: (event: OIDFlowProgressEvent) => void): () => void {
		this.wasmProgressCallbacks.add(callback);
		return () => { this.wasmProgressCallbacks.delete(callback); };
	}

	override onError(callback: (error: Error) => void): () => void {
		this.wasmErrorCallbacks.add(callback);
		return () => { this.wasmErrorCallbacks.delete(callback); };
	}

	// ===== Connection lifecycle =====

	override async connect(): Promise<void> {
		await this.ensureSession();
		this.wasmConnected = true;
	}

	override isConnected(): boolean {
		return this.wasmConnected;
	}

	override async disconnect(): Promise<void> {
		this.wasmConnected = false;
		this.failAllFlows('TRANSPORT_CLOSED', 'Transport disconnected');
		this.failAllVpFlows('TRANSPORT_CLOSED', 'Transport disconnected');
		const session = this.sessionPromise;
		const engine = this.enginePromise;
		this.sessionPromise = null;
		if (session && engine) {
			try {
				const [e, sessionId] = await Promise.all([engine, session]);
				await e.request('wmp.session.close', { wmp: { session_id: sessionId, version: '0.1' } });
			} catch {
				// the session dies with the page anyway
			}
		}
	}

	override resetReconnectAttempts(): void {
		// nothing to reconnect: the engine runs in the page
	}

	// ===== OID4VCI =====

	override async startOID4VCIFlow(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		if (params.authorizationCode) {
			return this.resumeAuthorization(params.authorizationCode);
		}
		if (params.credentialOfferUri || params.credentialOffer) {
			return this.startIssuance(params);
		}
		if (params.preAuthorizedCode) {
			return errorResult('TX_CODE_UNSUPPORTED',
				'Offers that need a transaction code are not supported by the in-browser engine');
		}
		return errorResult('INVALID_PARAMS', 'No credential offer or authorization code to continue with');
	}

	override sendCredentialNotification(flowId: string, notificationId: string, event: CredentialNotificationEvent): void {
		(async () => {
			const engine = await this.engine();
			const sessionId = await this.ensureSession();
			await wmpCall(engine, 'wmp.flow.start', {
				wmp: meta(sessionId),
				flow_id: `cn-${crypto.randomUUID()}`,
				flow_type: 'credential_notification',
				params: { issuance_flow_id: flowId, notification_id: notificationId, event },
			});
		})().catch((err) => logger.debug('[wasm] credential notification not forwarded', reason(err)));
	}

	// ===== OID4VP =====

	override async startOID4VPFlow(params: OID4VPFlowParams): Promise<OID4VPFlowResult> {
		if (params.selectedCredentials) {
			return this.answerSelection(params.selectedCredentials);
		}
		if (params.requestUriRef) {
			return this.startPresentation(params.requestUriRef, params.clientId ?? undefined);
		}
		return vpError('INVALID_PARAMS', 'No authorization request or credential selection to continue with');
	}

	/**
	 * The app's matching found nothing: answer the match with nothing, so the
	 * engine tells the verifier access_denied. Null when no match is open.
	 */
	override async reportNoMatchingCredentials(): Promise<OID4VPFlowResult | null> {
		const flow = this.currentVpFlow();
		if (!flow?.matchAnswer) return null;
		flow.noMatch = true;
		const done = this.waitForVp(flow, NO_MATCH_TIMEOUT_MS);
		this.answerMatch(flow, { selections: [] });
		const r = await done;
		return {
			success: false,
			error: {
				code: 'NO_MATCHING_CREDENTIALS',
				message: r.error?.message ?? 'No matching credentials',
				...(r.error?.details ? { details: r.error.details } : {}),
			},
		};
	}

	override async request<T>(flowRequest: OIDFlowRequest): Promise<OIDFlowResponse<T>> {
		throw new Error(`Generic requests are not supported by the in-browser engine (${flowRequest.type})`);
	}

    	// ===== The flow =====

	private async startIssuance(params: OID4VCIFlowParams): Promise<OID4VCIFlowResult> {
		if (!params.redirectUri) {
			return errorResult('INVALID_PARAMS', 'A redirect URI is required for the authorization-code flow');
		}
		// The offer is read here first: the client_id the authorization server
		// knows depends on the issuer, and the engine needs it at the start.
		let offer: Record<string, unknown>;
		try {
			offer = await this.readOffer(params);
		} catch (err) {
			return errorResult('OFFER_UNAVAILABLE', reason(err));
		}
		const clientId = await this.registeredClientId(offer.credential_issuer);
		const configurationIds = Array.isArray(offer.credential_configuration_ids)
			? offer.credential_configuration_ids.filter((id): id is string => typeof id === 'string')
			: [];
		const format = await this.configurationFormat(offer.credential_issuer as string, configurationIds[0]);

		let engine: WasmEngine;
		let sessionId: string;
		try {
			engine = await this.engine();
			sessionId = await this.ensureSession();
		} catch (err) {
			return errorResult('ENGINE_UNAVAILABLE', reason(err));
		}

		const flow = this.newFlow(`vci-${crypto.randomUUID()}`);
		flow.credentialIssuer = offer.credential_issuer as string;
		flow.configurationIds = configurationIds;
		flow.format = format;
		const result = this.waitForStep(flow);

		// Resolves when the flow completes, or once the authorization is opened
		// (the flow then stays open for the resume). The step result comes from
		// the notifications and host callbacks, settled below. The offer goes in
		// by value (it was fetched above); without a registered client_id the
		// engine uses the redirect_uri (the unregistered-client convention).
		wmpCall(engine, 'wmp.flow.start', {
			wmp: meta(sessionId),
			flow_id: flow.flowId,
			flow_type: 'oid4vci',
			params: {
				credential_offer: `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offer))}`,
				redirect_uri: params.redirectUri,
				...(clientId ? { client_id: clientId } : {}),
			},
		}).catch((err) => this.failFlow(flow, err));

		return result;
	}

	private async resumeAuthorization(code: string): Promise<OID4VCIFlowResult> {
		const pending = this.takePending();
		if (!pending) {
			return errorResult('NO_PENDING_AUTHORIZATION', 'No authorization in progress to resume');
		}
		let engine: WasmEngine;
		let sessionId: string;
		try {
			engine = await this.engine();
			sessionId = await this.ensureSession();
		} catch (err) {
			return errorResult('ENGINE_UNAVAILABLE', reason(err));
		}

		const flow = this.newFlow(pending.flowId);
		flow.credentialIssuer = pending.credentialIssuer;
		if (pending.configurationId) flow.configurationIds = [pending.configurationId];
		flow.format = pending.format;
		const result = this.waitForStep(flow);

		// The engine checks the state against its stash (CSRF); the app has
		// already compared the redirect's state with the one saved before it.
		wmpCall(engine, 'wmp.flow.action', {
			wmp: meta(sessionId),
			flow_id: flow.flowId,
			action: 'authorization_complete',
			params: { code, state: pending.state },
		}).catch((err) => this.failFlow(flow, err));

		return result;
	}

	private newFlow(flowId: string): VciFlow {
		const flow: VciFlow = { flowId, configurationIds: [], waiter: null, ended: false };
		this.vciFlows.set(flowId, flow);
		return flow;
	}

	private waitForStep(flow: VciFlow): Promise<OID4VCIFlowResult> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				flow.waiter = null;
				this.endFlow(flow);
				resolve(errorResult('TIMEOUT', 'The issuance took too long'));
			}, STEP_TIMEOUT_MS);
			flow.waiter = { resolve, timer };
		});
	}

	private settle(flow: VciFlow, result: OID4VCIFlowResult): void {
		const waiter = flow.waiter;
		flow.waiter = null;
		if (!waiter) return;
		clearTimeout(waiter.timer);
		waiter.resolve(result);
	}

	private endFlow(flow: VciFlow): void {
		flow.ended = true;
		this.vciFlows.delete(flow.flowId);
	}

	private failFlow(flow: VciFlow, err: unknown): void {
		if (flow.ended) return;
		this.endFlow(flow);
		const code = isWmpEngineError(err) && typeof err.data?.reason === 'string'
			? err.data.reason
			: 'FLOW_ERROR';
		this.settle(flow, errorResult(code.toUpperCase(), reason(err)));
	}

	private failAllFlows(code: string, message: string): void {
		Array.from(this.vciFlows.values()).forEach((flow) => {
			this.endFlow(flow);
			this.settle(flow, errorResult(code, message));
		});
	}

	private baseResult(flow: VciFlow): OID4VCIFlowResult {
		const r: OID4VCIFlowResult = { success: true, flowId: flow.flowId };
		if (flow.credentialIssuer) r.credentialIssuerIdentifier = flow.credentialIssuer;
		if (flow.configurationIds[0]) r.selectedCredentialConfigurationId = flow.configurationIds[0];
		return r;
	}

	/** The single flow a callback without a usable flow id belongs to. */
	private flowFor(flowId: string | undefined): VciFlow | undefined {
		if (flowId && this.vciFlows.has(flowId)) return this.vciFlows.get(flowId);
		const live = Array.from(this.vciFlows.values()).filter((f) => !f.ended);
		return live.length === 1 ? live[0] : undefined;
	}
    	// ===== The presentation flow =====

	private async startPresentation(requestUri: string, clientId: string | undefined): Promise<OID4VPFlowResult> {
		let engine: WasmEngine;
		let sessionId: string;
		try {
			engine = await this.engine();
			sessionId = await this.ensureSession();
		} catch (err) {
			return vpError('ENGINE_UNAVAILABLE', reason(err));
		}

		// A presentation left open (the user went back) is declined first.
		const previous = this.currentVpFlow();
		if (previous) this.answerMatch(previous, { selections: [] });

		const flow: VpFlow = { flowId: `vp-${crypto.randomUUID()}`, waiter: null, choices: new Map(), ended: false };
		this.vpFlows.set(flow.flowId, flow);
		this.currentVpFlowId = flow.flowId;
		const result = this.waitForVp(flow);

		// The URL form, so the engine compares the outer client_id with the
		// request object's (RFC 9101 §5.2). The call resolves only when the flow
		// ends; the steps come from the host callbacks and the notifications.
		const query = new URLSearchParams();
		if (clientId) query.set('client_id', clientId);
		query.set('request_uri', requestUri);
		wmpCall(engine, 'wmp.flow.start', {
			wmp: meta(sessionId),
			flow_id: flow.flowId,
			flow_type: 'oid4vp',
			params: `openid4vp://?${query.toString()}`,
		}).catch((err) => this.failVpFlow(flow, err));

		return result;
	}

	/** The user's selection answers the engine's open match ask. */
	private async answerSelection(selected: OID4VPSelectedCredential[]): Promise<OID4VPFlowResult> {
		const flow = this.currentVpFlow();
		if (!flow?.matchAnswer) {
			return vpError('NO_PRESENTATION_IN_PROGRESS', 'No presentation is waiting for a credential selection');
		}
		const choices = new Map<string, VpChoice>();
		for (const c of selected) {
			if (choices.has(c.credentialQueryId)) {
				return vpError('INVALID_SELECTION', `More than one credential selected for query ${c.credentialQueryId}`);
			}
			choices.set(c.credentialQueryId, {
				credentialId: c.walletCredentialRef,
				credentialQueryId: c.credentialQueryId,
				credentialRaw: c.credentialRaw,
				disclosedClaims: c.disclosedClaims ?? [],
			});
		}
		flow.choices = choices;
		flow.selectionHandle = choices.size ? newSelectionHandle() : undefined;

		const result = this.waitForVp(flow);
		this.answerMatch(flow, {
			selections: Array.from(choices.values()).map((c) => ({
				credential_query_id: c.credentialQueryId,
				credential_id: c.credentialId,
				disclosed_claims: c.disclosedClaims,
			})),
			...(flow.selectionHandle ? { handle: flow.selectionHandle } : {}),
		});
		return result;
	}

	private currentVpFlow(): VpFlow | undefined {
		const flow = this.currentVpFlowId ? this.vpFlows.get(this.currentVpFlowId) : undefined;
		return flow && !flow.ended ? flow : undefined;
	}

	private waitForVp(flow: VpFlow, timeoutMs = STEP_TIMEOUT_MS): Promise<OID4VPFlowResult> {
		if (flow.waiter) {
			clearTimeout(flow.waiter.timer);
			flow.waiter.resolve(vpError('SUPERSEDED', 'Superseded by a newer request'));
		}
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				flow.waiter = null;
				resolve(vpError('TIMEOUT', 'The presentation took too long'));
			}, timeoutMs);
			flow.waiter = { resolve, timer };
		});
	}

	private settleVp(flow: VpFlow, result: OID4VPFlowResult): void {
		const waiter = flow.waiter;
		flow.waiter = null;
		if (!waiter) return;
		clearTimeout(waiter.timer);
		waiter.resolve(result);
	}

	/** Answers the engine's match ask once; false when none is open. */
	private answerMatch(flow: VpFlow, answer: EngineMatchResult): boolean {
		const respond = flow.matchAnswer;
		if (!respond) return false;
		flow.matchAnswer = undefined;
		clearTimeout(flow.matchTimer);
		flow.matchTimer = undefined;
		respond(answer);
		return true;
	}

	private endVpFlow(flow: VpFlow): void {
		flow.ended = true;
		// An open match ask is answered with nothing, so the engine ends too.
		this.answerMatch(flow, { selections: [] });
		flow.choices.clear(); // the raw credentials are not kept past the flow
		flow.selectionHandle = undefined;
		this.vpFlows.delete(flow.flowId);
		if (this.currentVpFlowId === flow.flowId) this.currentVpFlowId = null;
	}

	private failVpFlow(flow: VpFlow, err: unknown): void {
		if (flow.ended) return;
		this.endVpFlow(flow);
		const data = isWmpEngineError(err) ? err.data : undefined;
		const code = typeof data?.reason === 'string' ? data.reason : 'FLOW_ERROR';
		this.settleVp(flow, vpError(code.toUpperCase(), reason(err), data as Record<string, unknown> | undefined));
	}

	private failAllVpFlows(code: string, message: string): void {
		Array.from(this.vpFlows.values()).forEach((flow) => {
			this.endVpFlow(flow);
			this.settleVp(flow, vpError(code, message));
		});
	}

	private handleVpNotification(flow: VpFlow, method: string, params: Record<string, unknown>): void {
		switch (method) {
			case 'wmp.flow.progress':
				this.emitWasmProgress({
					flowId: flow.flowId,
					stage: String(params.step ?? ''),
					payload: (params.payload ?? {}) as Record<string, unknown>,
				});
				break;
			case 'wmp.flow.complete': {
				const r = (params.result ?? {}) as Record<string, unknown>;
				const redirect = typeof r.redirect_uri === 'string' && r.redirect_uri ? { redirect_uri: r.redirect_uri } : undefined;
				let result: OID4VPFlowResult;
				if (r.presented === true) {
					result = { success: true, ...(flow.redirectUri ? { redirectUri: flow.redirectUri } : {}) };
				} else if (flow.noMatch || r.matched === false) {
					result = vpError('NO_MATCHING_CREDENTIALS', 'No matching credentials', redirect);
				} else if (r.declined === true) {
					result = vpError('PRESENTATION_DECLINED', 'The presentation was declined', redirect);
				} else if (r.refused === true) {
					// The engine's consent policy refused the selection (the reason class only).
					result = vpError('PRESENTATION_REFUSED', typeof r.reason === 'string' ? r.reason : 'The presentation was refused');
				} else {
					result = vpError('PRESENTATION_FAILED', 'The presentation ended without a response');
				}
				this.endVpFlow(flow);
				this.settleVp(flow, result);
				break;
			}
			case 'wmp.flow.error': {
				const data = (params.data ?? undefined) as Record<string, unknown> | undefined;
				this.endVpFlow(flow);
				this.settleVp(flow, vpError(
					typeof data?.reason === 'string' ? data.reason.toUpperCase() : `WMP_${params.code}`,
					typeof params.message === 'string' ? params.message : 'Presentation failed',
					data,
				));
				break;
			}
		}
	}

	/**
	 * The engine asks which credentials to present. The app's call resolves
	 * here with the query and the verifier; the ask stays open until the
	 * user's selection (or a no-match report, or the step timeout).
	 */
	private hostMatch(p: EngineMatchParams): Promise<EngineMatchResult> {
		const flow = this.vpFlows.get(p.flow_id);
		if (!flow || flow.ended) return Promise.resolve({ selections: [] });

		if (p.transaction_data?.length) {
			// Not bound into the presentation by the sign handler: never present without it.
			this.endVpFlow(flow);
			this.settleVp(flow, vpError('TRANSACTION_DATA_UNSUPPORTED',
				'Requests with transaction data are not supported by the in-browser engine'));
			return Promise.resolve({ selections: [] });
		}
		if (!p.dcql_query) {
			this.endVpFlow(flow);
			this.settleVp(flow, vpError('NO_DCQL_QUERY', 'The verifier sent no DCQL query'));
			return Promise.resolve({ selections: [] });
		}

		return new Promise<EngineMatchResult>((resolve) => {
			flow.matchAnswer = resolve;
			flow.matchTimer = setTimeout(() => {
				logger.warn('[wasm] no credential selection in time; declining the presentation');
				this.answerMatch(flow, { selections: [] });
			}, STEP_TIMEOUT_MS);
			this.settleVp(flow, {
				success: true,
				dcqlQuery: p.dcql_query as unknown as DcqlQuery.Input,
				verifierInfo: toVerifierInfo(p.verifier, p.dcql_query),
			});
		});
	}

	/** The selection screen was the consent: yes, for exactly what was selected. */
	private async hostConsent(p: EngineConsentParams): Promise<{ consented: boolean }> {
		const flow = this.vpFlows.get(p.flow_id);
		if (!flow || flow.ended || !flow.choices.size) return { consented: false };
		const selected = new Set(Array.from(flow.choices.values()).flatMap((c) => c.disclosedClaims));
		return { consented: (p.requested_claims ?? []).every((claim) => selected.has(claim)) };
	}

	/**
	 * The VP token, from the user's selection: the engine's ask names which
	 * query answers to include and must carry the selection's handle; the
	 * credential and the disclosed claims come from what the user chose.
	 */
	private async hostVp(p: EngineVpParams): Promise<EngineVpResult> {
		const flow = this.vpFlows.get(p.flow_id);
		if (!flow || flow.ended || !flow.selectionHandle) throw new Error('no consent for this presentation');
		if (p.selection_handle !== flow.selectionHandle) throw new Error('the selection handle is missing or unknown');
		if (p.transaction_data?.length) {
			return { vp_token: '', refusal: { code: 'UNSUPPORTED_TRANSACTION_DATA' } };
		}
		if (!p.selections?.length) throw new Error('no credential to present');

		const seen = new Set<string>();
		const credentialsToInclude = p.selections.map((s) => {
			const choice = flow.choices.get(s.credential_query_id);
			if (!choice || choice.credentialId !== s.credential_id || seen.has(s.credential_query_id)) {
				throw new Error(`credential query ${s.credential_query_id} was not selected`);
			}
			seen.add(s.credential_query_id);
			return {
				credentialId: choice.credentialId,
				credentialQueryId: choice.credentialQueryId,
				disclosedClaims: choice.disclosedClaims,
				credentialRaw: choice.credentialRaw,
			};
		});

		const response = await this.callSignHandler({
			flowId: flow.flowId,
			messageId: `vp-${crypto.randomUUID()}`,
			action: 'sign_presentation',
			params: {
				audience: p.audience,
				nonce: p.nonce,
				responseUri: p.response_uri || undefined,
				verifierJwkThumbprint: p.verifier_jwk_thumbprint || undefined,
				credentialsToInclude,
			},
		});
		// The DCQL vp_token object as JSON text: the engine passes it through.
		if (!response.vpToken) throw new Error('the sign handler returned no vp_token');
		return { vp_token: response.vpToken };
	}

    	// ===== The offer and the client =====

	private engineKv(): EngineKeyValue {
		if (!this.kvStore) this.kvStore = createStorageKv(this.wasmStorage);
		return this.kvStore;
	}

	private proxyFetch(): WasmEngineConfig['fetch'] {
		if (!this.proxyFetchFn) {
			this.proxyFetchFn = createProxyFetch({
				backendUrl: this.wasmOpts.backendUrl,
				getAuthToken: this.wasmOpts.getAuthToken,
				tenantId: this.wasmOpts.tenantId,
				maxBatchSize: this.wasmOpts.maxBatchSize,
			});
		}
		return this.proxyFetchFn;
	}

	/** The offer object: parsed from the value, or fetched from credential_offer_uri. */
	private async readOffer(params: OID4VCIFlowParams): Promise<Record<string, unknown>> {
		let text: string;
		if (params.credentialOffer) {
			text = params.credentialOffer;
		} else {
			const uri = params.credentialOfferUri ?? '';
			if (!/^https:\/\//.test(uri)) throw new Error('credential_offer_uri must be an https URL');
			const res = await this.proxyFetch()({
				method: 'GET',
				url: uri,
				headers: ['accept', 'application/json'],
				body: [],
			});
			if (res.status !== 200) throw new Error(`the credential offer could not be fetched (${res.status})`);
			text = new TextDecoder().decode(new Uint8Array(res.body));
		}
		let offer: unknown;
		try {
			offer = JSON.parse(text);
		} catch {
			throw new Error('the credential offer is not JSON');
		}
		if (!offer || typeof offer !== 'object' || typeof (offer as { credential_issuer?: unknown }).credential_issuer !== 'string') {
			throw new Error('the credential offer has no credential_issuer');
		}
		return offer as Record<string, unknown>;
	}

	/**
	 * The format of the offered configuration, from the issuer metadata
	 * (credential_configurations_supported). Best effort: undefined leaves the
	 * app to infer the format from the credential itself.
	 */
	private async configurationFormat(credentialIssuer: string, configurationId: string | undefined): Promise<string | undefined> {
		if (!configurationId) return undefined;
		try {
			const res = await this.proxyFetch()({
				method: 'GET',
				url: issuerMetadataUrl(credentialIssuer),
				headers: ['accept', 'application/json'],
				body: [],
			});
			if (res.status !== 200) throw new Error(`issuer metadata ${res.status}`);
			const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(res.body)));
			const format = metadata?.credential_configurations_supported?.[configurationId]?.format;
			return typeof format === 'string' ? format : undefined;
		} catch (err) {
			logger.warn('[wasm] could not read the credential format from the issuer metadata', reason(err));
			return undefined;
		}
	}

	private async registeredClientId(credentialIssuer: unknown): Promise<string | undefined> {
		if (typeof credentialIssuer !== 'string' || !this.wasmOpts.getRegisteredClientId) {
			logger.debug('[wasm] no client_id lookup configured; the client_id is the redirect_uri');
			return undefined;
		}
		try {
			const clientId = await this.wasmOpts.getRegisteredClientId(credentialIssuer);
			if (clientId) {
				logger.debug('[wasm] client_id for', credentialIssuer, 'is', clientId, '(the issuer record)');
			} else {
				logger.warn('[wasm] no issuer record with a clientId for', credentialIssuer, '; the client_id is the redirect_uri');
			}
			return clientId;
		} catch (err) {
			logger.warn('[wasm] registered client_id lookup failed; the client_id is the redirect_uri:', reason(err));
			return undefined;
		}
	}

	// ===== Engine and session =====

	private engine(): Promise<WasmEngine> {
		if (!this.enginePromise) {
			const config: WasmEngineConfig = {
				fetch: this.proxyFetch(),
				pdp: plainPdp(createTrustPdp(this.wasmOpts.trustEvaluators)),
				kv: this.engineKv(),
				host: {
					// Every ask goes through toPlain: the adapter hands some as ES Maps.
					sign: (p) => this.hostSign(toPlain(p)),
					signingKey: (p) => this.hostSigningKey(toPlain(p)),
					txCode: (p) => this.hostTxCode(toPlain(p)),
					openAuthorization: (p) => this.hostOpenAuthorization(toPlain(p)),
					dpopProof: (p) => this.hostDpopProof(toPlain(p)),
					attestation: (p) => this.hostAttestation(toPlain(p)),
					// Every callback is provided: for a missing one the adapter builds a
					// refusal with new Function(), which the page's CSP (no
					// 'unsafe-eval') blocks at construction.
					match: (p) => this.hostMatch(toPlain(p)),
					consent: (p) => this.hostConsent(toPlain(p)),
					vp: (p) => this.hostVp(toPlain(p)),
				},
				onNotification: (text) => this.handleNotification(text),
			};
			const factory = this.wasmOpts.engineFactory ?? createWasmEngine;
			this.enginePromise = factory(config).catch((err) => {
				this.enginePromise = null;
				throw err;
			});
		}
		return this.enginePromise;
	}

	private ensureSession(): Promise<string> {
		if (!this.sessionPromise) {
			this.sessionPromise = (async () => {
				const engine = await this.engine();
				const created = await wmpCall(engine, 'wmp.session.create', {
					wmp: { version: '0.1', sender: 'wallet-frontend' },
					capabilities_offered: { flows: { max_concurrent: 4 }, credential_notification: {} },
					security: { mode: 'tls' },
				});
				const sessionId = created?.wmp?.session_id;
				if (typeof sessionId !== 'string' || !sessionId) throw new Error('The engine created no session');
				return sessionId;
			})().catch((err) => {
				this.sessionPromise = null;
				throw err;
			});
		}
		return this.sessionPromise;
	}

	// ===== Notifications from the engine =====

	private handleNotification(text: string): void {
		let message: { method?: string; params?: Record<string, unknown> };
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}
		const params = message.params ?? {};
		logger.debug('[wasm] engine message', message.method, params.flow_id, params.step ?? '');
		const vpFlow = typeof params.flow_id === 'string' ? this.vpFlows.get(params.flow_id) : undefined;
		if (vpFlow) {
			this.handleVpNotification(vpFlow, message.method ?? '', params);
			return;
		}
		const flow = typeof params.flow_id === 'string' ? this.vciFlows.get(params.flow_id) : undefined;
		if (!flow) return; // a notification flow, or a flow that already ended

		switch (message.method) {
			case 'wmp.flow.progress':
				this.handleProgress(flow, String(params.step ?? ''), (params.payload ?? {}) as Record<string, unknown>);
				break;
			case 'wmp.flow.complete':
				this.handleComplete(flow, (params.result ?? {}) as Record<string, unknown>);
				break;
			case 'wmp.flow.error': {
				const data = (params.data ?? {}) as { reason?: unknown };
				this.endFlow(flow);
				this.settle(flow, errorResult(
					typeof data.reason === 'string' ? data.reason.toUpperCase() : `WMP_${params.code}`,
					typeof params.message === 'string' ? params.message : 'Issuance failed',
				));
				break;
			}
		}
	}

	private handleProgress(flow: VciFlow, step: string, payload: Record<string, unknown>): void {
		switch (step) {
			case 'offer_parsed':
				if (typeof payload.credential_issuer === 'string') flow.credentialIssuer = payload.credential_issuer;
				if (Array.isArray(payload.credential_configuration_ids)) {
					flow.configurationIds = payload.credential_configuration_ids.filter((id): id is string => typeof id === 'string');
				}
				break;
			case 'metadata_fetched':
				if (typeof payload.credential_issuer === 'string') flow.credentialIssuer = payload.credential_issuer;
				break;
			case 'authorization_required':
				if (typeof payload.authorization_url === 'string'
					&& typeof payload.state === 'string'
					&& typeof payload.code_verifier === 'string') {
					flow.authorization = {
						url: payload.authorization_url,
						state: payload.state,
						codeVerifier: payload.code_verifier,
					};
					flow.onAuthorization?.();
				}
				break;
			case 'deferred':
				if (typeof payload.transaction_id === 'string') flow.transactionId = payload.transaction_id;
				break;
		}
		// The verifier, PKCE verifier and tokens stay out of the app's progress events.
		this.emitWasmProgress({ flowId: flow.flowId, stage: step, payload: publicProgress(step, payload) });
	}

	private handleComplete(flow: VciFlow, r: Record<string, unknown>): void {
		this.endFlow(flow);
		if (r.deferred === true) {
			this.settle(flow, errorResult('DEFERRED_UNSUPPORTED',
				'The issuer deferred the credential; deferred issuance is not supported by the in-browser engine'));
			return;
		}
		const credential = typeof r.credential === 'string' ? r.credential : '';
		if (!credential) {
			this.settle(flow, errorResult('NO_CREDENTIAL', 'The issuer returned no credential'));
			return;
		}
		const issued: IssuedCredential = { credential };
		if (flow.format) issued.format = flow.format;
		if (typeof r.notification_id === 'string') issued.notification_id = r.notification_id;
		const result = this.baseResult(flow);
		result.credentials = [issued];
		this.settle(flow, result);
	}

	private emitWasmProgress(event: OIDFlowProgressEvent): void {
		Array.from(this.wasmProgressCallbacks).forEach((cb) => {
			try { cb(event); } catch (err) { logger.error('[wasm] progress callback failed', err); }
		});
	}

    	// ===== Host callbacks =====

	/** A fresh WSCD key for the next proof; its kid rides the sign ask. */
	private async hostSigningKey(p: EngineSigningKeyParams): Promise<{ jwk: Record<string, unknown> }> {
		if (p.key_id) {
			// Renewal (re-signing with an existing key) is not started by this transport.
			throw new Error('signing with an existing key is not supported');
		}
		const wscd = this.requireWscd();
		const [keypair] = await wscd.generateKeypairs(1);
		if (!keypair) throw new Error('the WSCD generated no key');
		const flow = this.flowFor(p.flow_id);
		if (flow) flow.lastKid = keypair.kid;
		const { d: _d, ...publicJwk } = keypair.publicKey as Record<string, unknown>;
		return { jwk: { ...publicJwk, kid: keypair.kid } };
	}

	private async hostSign(p: EngineSignParams): Promise<{ signature: number[] }> {
		if (p.algorithm !== 'ES256') throw new Error(`unsupported signing algorithm ${p.algorithm}`);
		const kid = p.key_id || this.flowFor(p.flow_id)?.lastKid;
		if (!kid) {
			// Without the signingKey callback the proof carries no key, and the
			// issuer cannot bind the credential: refuse rather than sign.
			throw new Error('no signing key for this proof (the engine adapter must support signingKey)');
		}
		const signature = await this.requireWscd().signRaw(kid, Uint8Array.from(p.to_sign));
		return { signature: Array.from(signature) };
	}

	private async hostTxCode(p: { flow_id: string }): Promise<string> {
		const flow = this.flowFor(p.flow_id);
		if (flow) {
			this.endFlow(flow);
			this.settle(flow, errorResult('TX_CODE_UNSUPPORTED',
				'Offers that need a transaction code are not supported by the in-browser engine'));
		}
		throw new Error('transaction codes are not supported');
	}

	/** The engine opens the authorization: hand the URL to the app, which navigates. */
	private async hostOpenAuthorization(p: { flow_id: string; url: string }): Promise<void> {
		// In a presentation this is the verifier's redirect after the response:
		// kept for the completion; the app navigates (and sanitizes it).
		const vpFlow = this.vpFlows.get(p.flow_id);
		if (vpFlow) {
			vpFlow.redirectUri = p.url;
			return;
		}
		const flow = this.flowFor(p.flow_id);
		if (!flow) throw new Error('no issuance flow for this authorization');
		// The state and the PKCE verifier come in the authorization_required
		// notification; the engine also stashed them in the kv before this call,
		// which serves when the notification does not arrive.
		const auth = flow.authorization
			?? await this.awaitAuthorization(flow)
			?? await this.authorizationFromStash(flow.flowId, p.url);
		if (!auth || auth.url !== p.url) {
			throw new Error('the authorization request was not announced');
		}

		const pending: PendingAuthorization = {
			flowId: flow.flowId,
			state: auth.state,
			credentialIssuer: flow.credentialIssuer,
			configurationId: flow.configurationIds[0],
			format: flow.format,
			savedAt: Date.now(),
		};
		this.wasmStorage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify(pending));

		const result = this.baseResult(flow);
		result.authorizationRequired = true;
		result.authorizationUrl = auth.url;
		result.codeVerifier = auth.codeVerifier;
		result.issuerState = auth.state;
		// This page is about to leave; the resume runs on a new engine session.
		this.endFlow(flow);
		this.settle(flow, result);
	}

	/** The state and PKCE verifier from the engine's own authorization stash. */
	private async authorizationFromStash(flowId: string, url: string): Promise<VciFlow['authorization']> {
		const raw = await this.engineKv().get(ENGINE_STASH_KEY(flowId));
		if (!raw) return undefined;
		try {
			const stash = JSON.parse(raw) as { state?: unknown; code_verifier?: unknown };
			if (typeof stash.state !== 'string' || typeof stash.code_verifier !== 'string') return undefined;
			logger.warn('[wasm] authorization_required was not notified; using the engine stash');
			return { url, state: stash.state, codeVerifier: stash.code_verifier };
		} catch {
			return undefined;
		}
	}

	private awaitAuthorization(flow: VciFlow): Promise<VciFlow['authorization']> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				flow.onAuthorization = undefined;
				resolve(flow.authorization);
			}, AUTHORIZATION_ANNOUNCE_TIMEOUT_MS);
			flow.onAuthorization = () => {
				clearTimeout(timer);
				flow.onAuthorization = undefined;
				resolve(flow.authorization);
			};
		});
	}

	/** Client-held DPoP through the app's sign handler; a refusal falls back to the engine's key. */
	private async hostDpopProof(p: EngineDpopProofParams): Promise<{ proof: string }> {
		const response = await this.callSignHandler({
			flowId: p.flow_id,
			messageId: `dpop-${crypto.randomUUID()}`,
			action: 'sign_client_auth',
			params: {
				htm: p.htm,
				htu: p.htu,
				dpopNonce: p.nonce || undefined,
				ath: p.access_token ? await accessTokenHash(p.access_token) : undefined,
			},
		});
		if (!response.dpopProof) throw new Error('no DPoP proof from the sign handler');
		return { proof: response.dpopProof };
	}

	/** The wallet attestation (WIA + PoP); a refusal lets the engine go on without it. */
	private async hostAttestation(p: EngineAttestationParams): Promise<{ wia: string; pop: string }> {
		const response = await this.callSignHandler({
			flowId: p.flow_id,
			messageId: `wia-${crypto.randomUUID()}`,
			action: 'sign_client_auth',
			params: {
				audience: p.audience,
				issuer: p.client_id,
				attestationChallenge: p.challenge || undefined,
			},
		});
		if (!response.clientAttestation || !response.clientAttestationPoP) {
			throw new Error('no wallet attestation from the sign handler');
		}
		return { wia: response.clientAttestation, pop: response.clientAttestationPoP };
	}

	private async callSignHandler(request: SignRequest): Promise<SignResponse> {
		const [handler] = Array.from(this.wasmSignHandlers);
		if (!handler) throw new Error('no sign handler registered');
		return handler(request);
	}

	private requireWscd(): IWscdManagerClient {
		const wscd = this.wasmOpts.getWscd();
		if (!wscd) throw new Error('the WSCD manager is not ready');
		return wscd;
	}

	private takePending(): PendingAuthorization | null {
		const raw = this.wasmStorage.getItem(PENDING_AUTHORIZATION_KEY);
		this.wasmStorage.removeItem(PENDING_AUTHORIZATION_KEY);
		if (!raw) return null;
		try {
			const p = JSON.parse(raw) as PendingAuthorization;
			if (typeof p.flowId !== 'string' || typeof p.state !== 'string') return null;
			if (typeof p.savedAt !== 'number' || Date.now() - p.savedAt > PENDING_MAX_AGE_MS) return null;
			return p;
		} catch {
			return null;
		}
	}
}

/** The PDP over plain requests (the adapter may hand nested JSON as Maps). */
function plainPdp(pdp: WasmEngineConfig['pdp']): WasmEngineConfig['pdp'] {
	return { evaluate: (request) => pdp.evaluate(toPlain(request)) };
}

function errorResult(code: string, message: string): OID4VCIFlowResult {
	return { success: false, error: { code, message } };
}

function vpError(code: string, message: string, details?: Record<string, unknown>): OID4VPFlowResult {
	return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}

/** The engine's verifier as the app's consent screen shows it. */
export function toVerifierInfo(v: EngineVerifierInfo, dcqlQuery?: Record<string, unknown> | null): OID4VPVerifierInfo {
	const prefix = /^([a-z0-9_]+):/.exec(v.client_id ?? '')?.[1];
	const purpose = (dcqlQuery as { credential_sets?: Array<{ purpose?: unknown }> } | null | undefined)?.credential_sets?.[0]?.purpose;
	return {
		name: v.name || v.client_id,
		domain: v.domain || undefined,
		logo: v.logo_uri || undefined,
		clientIdScheme: prefix === 'decentralized_identifier' ? 'did' : prefix,
		trustFramework: v.framework || undefined,
		reason: v.reason || undefined,
		// The engine stops an untrusted verifier before the match ask.
		trusted: v.trusted === true,
		trustedStatus: v.trusted === true ? 'trusted' : 'untrusted',
		...(typeof purpose === 'string' ? { purpose } : {}),
	};
}

/** An opaque handle tying the vp ask to the selection it was answered with. */
function newSelectionHandle(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function meta(sessionId: string): { session_id: string; version: string } {
	return { session_id: sessionId, version: '0.1' };
}

function reason(err: unknown): string {
	if (isWmpEngineError(err)) {
		return typeof err.data?.reason === 'string' ? err.data.reason : err.message;
	}
	return err instanceof Error ? err.message : String(err);
}

/**
 * The issuer metadata URL (OID4VCI 1.0 §12.2.2): the well-known segment goes
 * between the host and any path of the issuer identifier.
 */
export function issuerMetadataUrl(credentialIssuer: string): string {
	const url = new URL(credentialIssuer);
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.origin}/.well-known/openid-credential-issuer${path}`;
}

/** Progress payloads without secrets (the PKCE verifier, the state). */
function publicProgress(step: string, payload: Record<string, unknown>): Record<string, unknown> {
	if (step !== 'authorization_required') return payload;
	const { code_verifier: _v, state: _s, ...rest } = payload;
	return rest;
}

async function accessTokenHash(accessToken: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)));
	let binary = '';
	digest.forEach((b) => { binary += String.fromCharCode(b); });
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}