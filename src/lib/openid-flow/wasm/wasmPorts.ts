/**
 * The engine's environment callbacks ("ports") for the in-browser engine:
 *
 * - fetch: the engine's HTTP, sent through the wallet backend's /proxy,
 *   since the browser cannot call most issuers directly (CORS).
 * - pdp:   the engine's trust question, answered by the wallet's issuer and
 *          verifier trust evaluators (the backend's /v1/evaluate AuthZEN
 *          proxy). Fail closed.
 * - kv:    the engine's flow stash in sessionStorage, so the authorization-code
 *          flow survives the redirect's page reload (same tab, cleared with it).
 */
import { logger } from '@/logger';
import type { TrustEvaluators } from '../types';
import type {
	EngineEvaluationRequest,
	EngineEvaluationResponse,
	EngineHttpRequest,
	EngineHttpResponse,
	EngineKeyValue,
	WasmEngineConfig,
} from './WasmEngine';

export interface ProxyFetchOptions {
	/** The wallet backend, e.g. BACKEND_URL. */
	backendUrl: string;
	/** A valid backend access token; called before every request (tokens are short-lived). */
	getAuthToken: () => string | Promise<string>;
	/** The tenant, sent as X-Tenant-ID. */
	tenantId: string;
	/**
	 * The largest batch the wallet asks for. The engine sends one key proof per
	 * batch slot, taken from the issuer's batch_credential_issuance.batch_size,
	 * but its completion carries a single credential, and issuers may advertise
	 * more than they accept. Default 1.
	 */
	maxBatchSize?: number;
}

/** The backend's /proxy answer for non-binary URLs. */
interface ProxyResponse {
	status: number;
	headers?: Record<string, string>;
	data?: unknown;
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

/** {Name: value} -> [name, value, ...], names lower-cased. */
export function recordToFlat(headers: Record<string, string> | undefined): string[] {
	const flat: string[] = [];
	for (const [name, value] of Object.entries(headers ?? {})) {
		flat.push(name.toLowerCase(), value);
	}
	return flat;
}

function isProxyResponse(value: unknown): value is ProxyResponse {
	return !!value && typeof value === 'object' && typeof (value as ProxyResponse).status === 'number';
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
 * The engine's fetch, through POST {backend}/proxy.
 *
 * The proxy takes {url, method, headers, data} and answers {status, headers,
 * data}, where data is the upstream body parsed as JSON when it is JSON, else
 * the body as a string. JSON bodies are serialized again here, so key order and
 * number formatting may differ from the upstream bytes (fine for metadata and
 * token responses; signed content travels as JWT strings). Image URLs come
 * back as raw bytes instead.
 */
export function createProxyFetch(options: ProxyFetchOptions): WasmEngineConfig['fetch'] {
	const proxyUrl = new URL('/proxy', options.backendUrl).toString();
	const maxBatch = Math.max(1, options.maxBatchSize ?? 1);

	return async (request: EngineHttpRequest): Promise<EngineHttpResponse> => {
		const token = await options.getAuthToken();
		const body = request.body?.length ? decoder.decode(new Uint8Array(request.body)) : undefined;

		const res = await fetch(proxyUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Tenant-ID': options.tenantId,
			},
			body: JSON.stringify({
				url: request.url,
				method: request.method,
				headers: flatToRecord(request.headers ?? []),
				...(body !== undefined ? { data: body } : {}),
			}),
		});

		const contentType = res.headers.get('content-type') ?? '';
		const raw = new Uint8Array(await res.arrayBuffer());

		// The JSON envelope: {status, headers, data}.
		if (contentType.includes('application/json')) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(decoder.decode(raw));
			} catch {
				parsed = undefined;
			}
			if (isProxyResponse(parsed)) {
				const { data } = parsed;
				if (ISSUER_METADATA_PATH.test(request.url)) capBatchSize(data, maxBatch);
				const text = data === undefined || data === null
					? ''
					: typeof data === 'string' ? data : JSON.stringify(data);
				if (parsed.status >= 400) {
					logger.warn('[wasm-engine] upstream answered', parsed.status, request.url, text.slice(0, 300));
				}
				return {
					status: parsed.status,
					headers: recordToFlat(parsed.headers),
					body: Array.from(encoder.encode(text)),
				};
			}
		}

		// The proxy itself refused (401, 400, 500), or a binary (image) answer.
		if (!res.ok) {
			throw new Error(`proxy ${res.status}: ${decoder.decode(raw).slice(0, 200)}`);
		}
		const headers: string[] = [];
		res.headers.forEach((value, name) => headers.push(name, value));
		return { status: res.status, headers, body: Array.from(raw) };
	};
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

type VerifierScheme = 'x509_san_dns' | 'did' | 'https' | 'pre-registered';

/**
 * The verifier evaluator's client_id scheme, from the engine's scheme name
 * (context.client_id_scheme): the same mapping the WebSocket transport makes
 * for the backend's trust questions, with the DID alias named as the
 * evaluator knows it.
 */
function verifierScheme(clientId: string, context: Record<string, unknown> | undefined): { scheme: VerifierScheme; clientId: string; identifier: string } {
	const name = typeof context?.client_id_scheme === 'string' ? context.client_id_scheme : 'x509_san_dns';
	if (name === 'decentralized_identifier') {
		return { scheme: 'did', clientId, identifier: clientId.replace(/^decentralized_identifier:/, '') };
	}
	const identifier = name === 'x509_san_dns' && clientId.startsWith('x509_san_dns:')
		? clientId.slice('x509_san_dns:'.length)
		: clientId;
	return { scheme: name as VerifierScheme, clientId, identifier };
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
						keyMaterial: keyMaterial ?? { type: 'kid', key: '' },
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
/** Stash entries older than this are dropped (an abandoned authorization). */
const KV_MAX_AGE_MS = 60 * 60 * 1000;

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