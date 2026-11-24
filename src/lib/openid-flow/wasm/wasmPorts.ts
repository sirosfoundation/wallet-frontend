/**
 * The engine's environment callbacks ("ports") for the in-browser engine:
 *
 * - fetch: the engine's HTTP, straight from the page to the issuer or
 *   verifier: nothing goes through the wallet backend. Servers without CORS
 *   headers cannot be reached this way, and need the remote engine.
 * - pdp:   the engine's trust question, answered by the wallet's issuer and
 *          verifier trust evaluators (the backend's /v1/evaluate AuthZEN
 *          proxy). Fail closed.
 * - kv:    the engine's flow stash in sessionStorage, so the authorization-code
 *          flow survives the redirect's page reload (same tab, cleared with it).
 */
import { logger } from '@/logger';
import { ENGINE_PENDING_FLOW_MAX_AGE_MS } from '@/config';
import type { TrustEvaluators } from '../types';
import type {
	EngineEvaluationRequest,
	EngineEvaluationResponse,
	EngineHttpRequest,
	EngineHttpResponse,
	EngineKeyValue,
	WasmEngineConfig,
} from './WasmEngine';
import { parseClientIdScheme, type ClientIdScheme } from 'wallet-common';


/** The host of a URL, for logs; never the path or query. */
function hostOf(url: string): string {
	try { return new URL(url).host; } catch { return '(invalid url)'; }
}
export interface DirectFetchOptions {
	/**
	 * The largest batch the wallet asks for. The engine sends one key proof per
	 * batch slot, taken from the issuer's batch_credential_issuance.batch_size,
	 * but its completion carries a single credential, and issuers may advertise
	 * more than they accept. Default 1.
	 */
	maxBatchSize?: number;
	/** Told the host the browser could not reach (most often: no CORS headers). */
	onUnreachable?: (host: string) => void;
	/** For tests. Defaults to the global fetch. */
	fetchImpl?: typeof fetch;
}

/**
 * The browser could not reach an issuer or verifier: a network failure, or,
 * most often, a server that sends no CORS headers, which a page can never
 * read. The remote engine (WMP) reaches such servers from the backend.
 */
export class UnreachableFromBrowserError extends Error {
	constructor(readonly host: string) {
		super(`${host} could not be reached from the browser (it may not allow cross-origin requests); the remote engine can reach it`);
		this.name = 'UnreachableFromBrowserError';
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ISSUER_METADATA_PATH = /\/\.well-known\/openid-credential-issuer(\/|\?|$)/;

/** [name, value, name, value, ...] -> {name: value}; repeated names are comma-joined. */
export function flatToRecord(flat: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i + 1 < flat.length; i += 2) {
		const name = flat[i];
		const value = flat[i + 1];
		out[name] = name in out ? `${out[name]}, ${value}` : value;
	}
	return out;
}

/** Lowers an advertised batch_size to the wallet's maximum. */
function capBatchSize(data: unknown, max: number): void {
	if (!data || typeof data !== 'object') return;
	const batch = (data as { batch_credential_issuance?: { batch_size?: unknown } }).batch_credential_issuance;
	if (batch && typeof batch.batch_size === 'number' && batch.batch_size > max) {
		batch.batch_size = max;
	}
}
/**
 * The engine's fetch, straight from the page to the issuer or verifier.
 *
 * Local mode sends nothing through the wallet backend: the backend never sees
 * which issuers and verifiers the user meets, nor the tokens, credentials and
 * presentations exchanged with them. The cost is CORS: a server that sends no
 * CORS headers cannot be read from a page, and fails here with
 * UnreachableFromBrowserError; such servers need the remote engine. Only the
 * response headers the server exposes (Access-Control-Expose-Headers) are
 * readable, which matters for DPoP-Nonce.
 *
 * No cookies and no referrer go with the request: the wallet's origin and any
 * session the user has with the server stay out of it.
 */
export function createDirectFetch(options: DirectFetchOptions = {}): WasmEngineConfig['fetch'] {
	const maxBatch = Math.max(1, options.maxBatchSize ?? 1);
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

	return async (request: EngineHttpRequest): Promise<EngineHttpResponse> => {
		const body = request.body?.length ? new Uint8Array(request.body) : undefined;
		let res: Response;
		try {
			res = await fetchImpl(request.url, {
				method: request.method,
				headers: flatToRecord(request.headers ?? []),
				body,
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				cache: 'no-store',
			});
		} catch {
			// fetch() rejects only when there is no readable response at all.
			const host = hostOf(request.url);
			options.onUnreachable?.(host);
			throw new UnreachableFromBrowserError(host);
		}

		let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer());
		if (ISSUER_METADATA_PATH.test(request.url) && (res.headers.get('content-type') ?? '').includes('json')) {
			bytes = capBatchSizeInJson(bytes, maxBatch);
		}
		if (res.status >= 400) {
			// Status and host only: paths, queries and bodies can carry codes and tokens.
			logger.warn('[wasm-engine] upstream answered', res.status, hostOf(request.url));
		}
		const headers: string[] = [];
		res.headers.forEach((value, name) => headers.push(name.toLowerCase(), value));
		return { status: res.status, headers, body: Array.from(bytes) };
	};
}

/** The issuer metadata with batch_size capped; the bytes as they were when it is not JSON. */
function capBatchSizeInJson(bytes: Uint8Array, max: number): Uint8Array {
	let data: unknown;
	try {
		data = JSON.parse(decoder.decode(bytes));
	} catch {
		return bytes;
	}
	const batch = (data as { batch_credential_issuance?: { batch_size?: unknown } } | null)?.batch_credential_issuance;
	if (!batch || typeof batch.batch_size !== 'number' || batch.batch_size <= max) return bytes;
	capBatchSize(data, max);
	return encoder.encode(JSON.stringify(data));
}
/** The engine's opaque key material, as the issuer trust evaluator takes it. */
export function parseKeyMaterial(bytes: number[] | undefined): { type: 'jwk' | 'x5c'; key: unknown } | undefined {
	if (!bytes?.length) return undefined;
	const text = decoder.decode(new Uint8Array(bytes)).trim();

	// A signed-metadata JWT: the key material is in its protected header.
	const parts = text.split('.');
	if (parts.length === 3 && /^[A-Za-z0-9_-]+$/.test(parts[0])) {
		try {
			const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
			const header = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
			if (Array.isArray(header.x5c) && header.x5c.length) return { type: 'x5c', key: header.x5c };
			if (header.jwk && typeof header.jwk === 'object') return { type: 'jwk', key: header.jwk };
		} catch {
			// not a JWT after all
		}
		return undefined;
	}

	try {
		const json = JSON.parse(text);
		if (Array.isArray(json) && json.length && json.every((c) => typeof c === 'string')) return { type: 'x5c', key: json };
		if (json && Array.isArray(json.keys)) return { type: 'jwk', key: json.keys };
		if (json && typeof json.kty === 'string') return { type: 'jwk', key: json };
	} catch {
		// a jwks_uri or other text: no inline key material
	}
	return undefined;
}

/**
 * The verifier evaluator's client_id scheme, from the engine's scheme name
 * (context.client_id_scheme): the same mapping the WebSocket transport makes
 * for the backend's trust questions, with the DID alias named as the
 * evaluator knows it. Any other client_id (a Digital Credentials API origin,
 * a redirect URI) goes through the wallet's own parser, as the DC API path
 * does.
 */
function verifierScheme(clientId: string, context: Record<string, unknown> | undefined): ClientIdScheme {
	const name = typeof context?.client_id_scheme === 'string' ? context.client_id_scheme : 'x509_san_dns';
	if (name === 'decentralized_identifier') {
		return { scheme: 'did', clientId, identifier: clientId.replace(/^decentralized_identifier:/, '') };
	}
	if (name === 'x509_san_dns') {
		const identifier = clientId.startsWith('x509_san_dns:') ? clientId.slice('x509_san_dns:'.length) : clientId;
		return { scheme: 'x509_san_dns', clientId, identifier };
	}
	return parseClientIdScheme(clientId);
}

/**
 * The engine's PDP over the wallet's trust evaluators: issuers through the
 * issuer evaluator, verifiers (resource_type credential-verifier) through the
 * verifier evaluator. Any other subject, and any evaluator error, is refused
 * (fail closed).
 */
export function createTrustPdp(trust: TrustEvaluators): WasmEngineConfig['pdp'] {
	return {
		evaluate: async (request: EngineEvaluationRequest): Promise<EngineEvaluationResponse> => {
			const kind = request.resource_type ?? 'credential-issuer';
			if (kind !== 'credential-issuer' && kind !== 'credential-verifier') {
				return { trusted: false, decision: `unsupported trust subject: ${kind}` };
			}
			try {
				const keyMaterial = parseKeyMaterial(request.key_material);
				const result = kind === 'credential-verifier'
					? await trust.evaluateVerifierTrust({
						clientIdScheme: verifierScheme(request.subject, request.context),
						// No inline key material: the evaluator resolves it (a DID, an origin).
						keyMaterial: keyMaterial ?? { type: 'resolution', key: [] },
						responseUri: typeof request.context?.response_uri === 'string' ? request.context.response_uri : undefined,
					})
					: await trust.evaluateIssuerTrust({
						issuerId: request.subject,
						keyMaterial,
						context: request.context,
					});
				const reason = typeof result.metadata?.reason === 'string' ? result.metadata.reason : undefined;
				return { trusted: result.trusted === true, decision: reason ?? String(result.status ?? '') };
			} catch (err) {
				logger.warn(`[wasm-engine] ${kind} trust evaluation failed`, err);
				return { trusted: false, decision: err instanceof Error ? err.message : 'trust evaluation failed' };
			}
		},
	};
}

const KV_PREFIX = 'wasm-engine:';

/** Stash entries older than this are dropped (an abandoned authorization; ENGINE_PENDING_FLOW_MAX_AGE_IN_SECONDS). */
const KV_MAX_AGE_MS = ENGINE_PENDING_FLOW_MAX_AGE_MS ?? 60 * 60 * 1000;
/**
 * The engine's flow stash (the authorization-code stash: the PKCE verifier,
 * state and offer, read back after the redirect). sessionStorage by default:
 * the redirect comes back to the same tab, and the verifier never outlives it.
 * Entries carry a timestamp and expire after an hour; anything malformed reads
 * as absent.
 */
export function createStorageKv(storage: Storage = window.sessionStorage, now: () => number = Date.now): EngineKeyValue {
	const read = (key: string): string | null => {
		const raw = storage.getItem(KV_PREFIX + key);
		if (raw === null) return null;
		try {
			const { v, t } = JSON.parse(raw) as { v: string; t: number };
			if (typeof v !== 'string' || typeof t !== 'number' || now() - t > KV_MAX_AGE_MS) {
				storage.removeItem(KV_PREFIX + key);
				return null;
			}
			return v;
		} catch {
			storage.removeItem(KV_PREFIX + key);
			return null;
		}
	};
	return {
		get: async (key) => read(key),
		put: async (key, value) => {
			storage.setItem(KV_PREFIX + key, JSON.stringify({ v: value, t: now() }));
		},
		del: async (key) => {
			storage.removeItem(KV_PREFIX + key);
		},
	};
}

/** Where the in-browser engine keeps an authorization across the issuer redirect. */
export const PENDING_AUTHORIZATION_KEY = 'wasm_oid4vci_pending_authorization';

/**
 * Removes what the in-browser engine keeps in the tab's storage (its flow
 * state and a pending authorization), so none of it carries over to the next
 * user of this tab. Called on logout.
 */
export function clearWasmEngineStorage(storage: Storage = window.sessionStorage): void {
	const keys: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key?.startsWith(KV_PREFIX)) keys.push(key);
	}
	keys.forEach((key) => storage.removeItem(key));
	storage.removeItem(PENDING_AUTHORIZATION_KEY);
}

export interface ClientIdLookupOptions {
	backendUrl: string;
	tenantId: string;
	getAuthToken: () => string | Promise<string>;
}

const withoutTrailingSlash = (u: string) => u.replace(/\/+$/, '');

/**
 * The client_id the wallet is registered under at an issuer's authorization
 * server: the backend's issuer record (GET /issuer/all), as the server-side
 * engine uses it. Only the public clientId is read; anything else the record
 * carries is ignored. Undefined when the issuer has no record or no clientId.
 */
export function createRegisteredClientIdLookup(options: ClientIdLookupOptions): (credentialIssuer: string) => Promise<string | undefined> {
	return async (credentialIssuer: string) => {
		const token = await options.getAuthToken();
		const res = await fetch(new URL('/issuer/all', options.backendUrl).toString(), {
			headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': options.tenantId },
		});
		if (!res.ok) throw new Error(`issuer list ${res.status}`);
		const issuers: unknown = await res.json();
		if (!Array.isArray(issuers)) return undefined;
		const wanted = withoutTrailingSlash(credentialIssuer);
		const record = issuers.find((i): i is { credentialIssuerIdentifier: string; clientId?: unknown } =>
			!!i && typeof i === 'object' && typeof (i as { credentialIssuerIdentifier?: unknown }).credentialIssuerIdentifier === 'string'
			&& withoutTrailingSlash((i as { credentialIssuerIdentifier: string }).credentialIssuerIdentifier) === wanted);
		return record && typeof record.clientId === 'string' && record.clientId ? record.clientId : undefined;
	};
}
