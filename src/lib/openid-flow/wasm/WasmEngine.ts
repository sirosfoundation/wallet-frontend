/**
 * The in-browser WMP engine (siros-wallet-core, engine-adapter-wasm).
 *
 * The engine runs OpenID4VCI and OpenID4VP inside the page. It speaks the same WMP methods
 * as the remote engine (wmp.session.create, wmp.flow.start, wmp.flow.action),
 * but instead of exchanging sub-flow messages over HTTP+SSE it calls the
 * callbacks of the config object below, and hands its outgoing notifications
 * (wmp.flow.progress / complete / error) to `onNotification`.
 *
 * This file only loads the module, describes the callback contract, and
 * creates engines. The callbacks themselves live in wasmPorts.ts (fetch, pdp,
 * kv) and in OIDFlowWasmTransport (the host).
 *
 * The module is the wasm-pack output in ./pkg, which is not in git: it is
 * built from siros-wallet-core with utils/build-wasm-engine.sh. It is loaded
 * on demand (its own chunk, fetched only when the engine starts), and a build
 * without it still compiles: the engine then fails to start with a clear
 * error, and only when WASM_ENGINE_ENABLED is set.
 */
import { logger } from '@/logger';

/** The engine as the wallet uses it (the wasm-bindgen WasmEngine class). */
export interface WasmEngine {
	request(method: string, params: unknown): Promise<unknown>;
	free?(): void;
}

/** The generated package's exports this file uses. */
interface EnginePackage {
	default: () => Promise<unknown>;
	WasmEngine: new (config: WasmEngineConfig) => WasmEngine;
}

const PACKAGE_PATH = './pkg/engine_adapter_wasm.js';
const packageLoaders = import.meta.glob<EnginePackage>('./pkg/engine_adapter_wasm.js');

/** One HTTP request the engine wants to make (headers are flat [name, value, ...]). */
export interface EngineHttpRequest {
	method: string;
	url: string;
	headers: string[];
	body: number[];
	purpose?: string;
	maxResponseBytes?: number;
	redirects?: number;
	allowPlaintext?: boolean;
	timeoutMs?: number;
}

/** The answer to an EngineHttpRequest (headers flat, body as bytes). */
export interface EngineHttpResponse {
	status: number;
	headers: string[];
	body: number[];
}

/** A trust question: is this issuer (or verifier) and its key material trusted? */
export interface EngineEvaluationRequest {
	/** The issuer or verifier identifier. */
	subject: string;
	/** Opaque bytes: a signed-metadata JWT, a JSON x5c array, a JWKS or JWK, or a jwks_uri. */
	key_material: number[];
	/** 'credential-issuer' or 'credential-verifier'. */
	resource_type?: string | null;
	context?: Record<string, unknown>;
}

export interface EngineEvaluationResponse {
	trusted: boolean;
	decision?: string;
}

/** host.sign: sign `to_sign` with the named key, return the raw signature bytes. */
export interface EngineSignParams {
	flow_id: string;
	to_sign: number[];
	key_id?: string | null;
	algorithm: string;
}

/** host.signingKey: the public JWK (with kid) of the key the next proof binds to. */
export interface EngineSigningKeyParams {
	flow_id: string;
	key_id?: string | null;
	/** A new key must be generated (each credential in a batch binds to its own key). */
	fresh?: boolean;
}

/** host.dpopProof: a whole DPoP proof from the wallet's client-held key. */
export interface EngineDpopProofParams {
	flow_id: string;
	key_id?: string | null;
	htm: string;
	htu: string;
	access_token?: string;
	nonce?: string;
}

/** host.attestation: the wallet attestation (WIA) and its PoP for the AS. */
export interface EngineAttestationParams {
	flow_id: string;
	audience: string;
	client_id: string;
	challenge: string;
}

/** The verifier as the engine resolved it (engine-ports VerifierInfo). */
export interface EngineVerifierInfo {
	/** The client metadata's client_name, else the client_id. */
	name: string;
	/** The client_id, with its scheme prefix. */
	client_id: string;
	/** The scheme as a serde enum: "X509SanDns", ..., or {Unknown: "..."}. */
	client_id_scheme?: unknown;
	domain?: string;
	logo_uri?: string;
	trusted: boolean;
	framework?: string;
	reason?: string;
}

/** One credential answering one DCQL credential query (engine-ports VpSelection). */
export interface EngineVpSelection {
	credential_query_id: string;
	credential_id: string;
	disclosed_claims: string[];
}

/** host.match: which of the wallet's credentials answer the request. */
export interface EngineMatchParams {
	flow_id: string;
	dcql_query?: Record<string, unknown> | null;
	scope?: string;
	verifier: EngineVerifierInfo;
	/** The raw (base64url) transaction data entries. */
	transaction_data?: string[];
}

/** The match answer; no selections means nothing is presented (the engine refuses the verifier). */
export interface EngineMatchResult {
	selections: EngineVpSelection[];
	/** Opaque to the engine; it comes back unchanged in the vp ask. */
	handle?: string;
}

/** host.consent: the user's consent to what the match selected. */
export interface EngineConsentParams {
	flow_id: string;
	purpose: string;
	requested_claims: string[];
	transaction_data: string[];
}

/** host.vp: build and sign the VP token for the selected credentials. */
export interface EngineVpParams {
	flow_id: string;
	audience: string;
	nonce: string;
	selections: EngineVpSelection[];
	response_uri: string;
	verifier_jwk_thumbprint?: string;
	verifier_session_id?: string;
	transaction_data?: string[];
	origin?: string;
	selection_handle?: string;
}

/**
 * The vp answer: one token per selection, newline-separated, or a DCQL
 * vp_token object as JSON text (passed through). A refusal (SIGN_REFUSED,
 * UNSUPPORTED_TRANSACTION_DATA) instead makes the engine refuse the verifier.
 */
export interface EngineVpResult {
	vp_token: string;
	refusal?: { code: string };
}

/** The page's host: the sub-flows the engine asks the wallet for. */
export interface EngineHost {
	sign: (params: EngineSignParams) => Promise<{ signature: number[] }>;
	signingKey?: (params: EngineSigningKeyParams) => Promise<{ jwk: Record<string, unknown> }>;
	txCode?: (params: { flow_id: string }) => Promise<string>;
	/** Also the verifier's post-response redirect, in a presentation. */
	openAuthorization?: (params: { flow_id: string; url: string }) => Promise<void>;
	dpopProof?: (params: EngineDpopProofParams) => Promise<{ proof: string }>;
	attestation?: (params: EngineAttestationParams) => Promise<{ wia: string; pop: string }>;
	match?: (params: EngineMatchParams) => Promise<EngineMatchResult>;
	consent?: (params: EngineConsentParams) => Promise<{ consented: boolean }>;
	vp?: (params: EngineVpParams) => Promise<EngineVpResult>;
	progress?: (params: unknown) => void;
}

/** The engine's flow stash (the authorization-code resume reads it after the redirect). */
export interface EngineKeyValue {
	get: (key: string) => Promise<string | null>;
	put: (key: string, value: string) => Promise<void>;
	del: (key: string) => Promise<void>;
}

export interface WasmEngineConfig {
	fetch: (request: EngineHttpRequest) => Promise<EngineHttpResponse>;
	pdp: { evaluate: (request: EngineEvaluationRequest) => Promise<EngineEvaluationResponse> };
	host: EngineHost;
	kv?: EngineKeyValue;
	/** The engine's outgoing notifications, as JSON-RPC text. */
	onNotification?: (jsonText: string) => void;
}

/** The JSON-RPC error object the engine rejects with. */
export interface WmpEngineError {
	code: number;
	message: string;
	data?: { reason?: string; [key: string]: unknown };
}

export function isWmpEngineError(err: unknown): err is WmpEngineError {
	return !!err && typeof err === 'object' && typeof (err as WmpEngineError).code === 'number';
}

let boot: Promise<EnginePackage> | null = null;

/** Loads the package and compiles the .wasm, once per page. */
export function bootWasmEngine(): Promise<EnginePackage> {
	if (!boot) {
		const load = packageLoaders[PACKAGE_PATH];
		if (!load) {
			return Promise.reject(new Error(
				'The in-browser engine is not part of this build (src/lib/openid-flow/wasm/pkg is missing; see utils/build-wasm-engine.sh)'));
		}
		boot = load()
			.then(async (pkg) => {
				await pkg.default();
				return pkg;
			})
			.catch((err: unknown) => {
				boot = null; // allow a retry after a failed load
				throw err;
			});
	}
	return boot;
}

/** Boots the module (once) and builds an engine over the given callbacks. */
export async function createWasmEngine(config: WasmEngineConfig): Promise<WasmEngine> {
	const pkg = await bootWasmEngine();
	return new pkg.WasmEngine(config);
}

/** One WMP call on the in-page engine, with a refusal logged. */
export async function wmpCall<T = any>(engine: WasmEngine, method: string, params: unknown): Promise<T> {
	try {
		return (await engine.request(method, params)) as T;
	} catch (err) {
		const e = err as WmpEngineError;
		logger.warn('[wasm-engine]', method, e?.code, e?.message, e?.data?.reason ?? '');
		throw err;
	}
}

/**
 * The adapter's arguments as plain values. JsHost serializes with
 * serde_wasm_bindgen's defaults, which turn a JSON object (the asks built
 * with serde_json::json!, such as openAuthorization's {flow_id, url} and
 * txCode's {flow_id}, and any nested JSON such as a trust context) into an
 * ES Map rather than a plain object. Maps become objects here, deeply.
 */
export function toPlain<T = any>(value: unknown): T {
	if (value instanceof Map) {
		const out: Record<string, unknown> = {};
		value.forEach((v, k) => { out[String(k)] = toPlain(v); });
		return out as T;
	}
	if (Array.isArray(value)) return value.map((v) => toPlain(v)) as T;
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
		return out as T;
	}
	return value as T;
}