import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OIDFlowWasmTransport, PENDING_AUTHORIZATION_KEY, issuerMetadataUrl } from '../transports/OIDFlowWasmTransport';
import { createWasmEngine, toPlain, type WasmEngine, type WasmEngineConfig } from '../wasm/WasmEngine';
import { createProxyFetch, createRegisteredClientIdLookup, createStorageKv, createTrustPdp, parseKeyMaterial } from '../wasm/wasmPorts';
import type { TrustEvaluators } from '../types';
import type { IWscdManagerClient } from '@/lib/wscd-manager';

// vi.mock is hoisted above the imports.

vi.mock('@/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// The tests inject a fake engine through engineFactory; the generated
// wasm-bindgen package is never loaded.

/** In-memory Storage. */
class MemoryStorage implements Storage {
	private m = new Map<string, string>();
	get length() { return this.m.size; }
	clear() { this.m.clear(); }
	getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
	key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
	removeItem(k: string) { this.m.delete(k); }
	setItem(k: string, v: string) { this.m.set(k, v); }
}

type Handler = (params: any, config: WasmEngineConfig) => Promise<unknown>;

/**
 * As the real adapter passes the json!-built asks (openAuthorization, txCode):
 * serde_wasm_bindgen's default turns a JSON object into an ES Map.
 */
const asMap = (o: Record<string, unknown>): any => new Map(Object.entries(o));

/** A scripted engine: each WMP method answers through a handler that may call the host. */
function fakeEngine(handlers: Record<string, Handler>) {
	const calls: Array<{ method: string; params: any }> = [];
	let config!: WasmEngineConfig;
	const factory = async (c: WasmEngineConfig) => {
		config = c;
		return {
			request: async (method: string, params: any) => {
				calls.push({ method, params });
				if (method === 'wmp.session.create') return { wmp: { session_id: 'ses-1' } };
				const h = handlers[method];
				if (!h) return Promise.reject({ code: -32601, message: 'Method not found' });
				return h(params, config);
			},
		} as unknown as WasmEngine;
	};
	const notify = (method: string, params: Record<string, unknown>) =>
		config.onNotification?.(JSON.stringify({ jsonrpc: '2.0', method, params }));
	return { factory, calls, notify, getConfig: () => config };
}

function fakeWscd() {
	return {
		generateKeypairs: vi.fn(async (n: number) =>
			Array.from({ length: n }, (_, i) => ({ kid: `kid-${i + 1}`, publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } }))),
		signRaw: vi.fn(async () => new Uint8Array([1, 2, 3])),
	} as unknown as IWscdManagerClient & { generateKeypairs: ReturnType<typeof vi.fn>; signRaw: ReturnType<typeof vi.fn> };
}

const trust: TrustEvaluators = {
	evaluateIssuerTrust: vi.fn(async () => ({ trusted: true, status: 'trusted' })),
	evaluateVerifierTrust: vi.fn(async () => ({ trusted: false, status: 'untrusted' })),
} as unknown as TrustEvaluators;

function transport(
	engine: ReturnType<typeof fakeEngine>,
	storage: Storage,
	wscd = fakeWscd(),
	extra: Partial<ConstructorParameters<typeof OIDFlowWasmTransport>[0]> = {},
) {
	return new OIDFlowWasmTransport({
		backendUrl: 'https://backend.example',
		tenantId: 'default',
		getAuthToken: async () => 'tok',
		trustEvaluators: trust,
		getWscd: () => wscd,
		storage,
		engineFactory: engine.factory,
		...extra,
	});
}

const OFFER_URI = 'https://issuer.example/offer/1';
const OFFER = { credential_issuer: 'https://issuer.example', credential_configuration_ids: ['pid'], grants: { authorization_code: {} } };
const OFFER_JSON = JSON.stringify(OFFER);

const ISSUER_METADATA = {
	credential_issuer: 'https://issuer.example',
	credential_configurations_supported: { pid: { format: 'mso_mdoc', scope: 'pid' } },
};

/** The backend /proxy: the credential offer and the issuer metadata. */
function stubProxy() {
	const calls: any[] = [];
	vi.stubGlobal('fetch', async (url: string, init: any) => {
		const body = JSON.parse(init.body);
		calls.push({ url, body });
		const data = body.url === OFFER_URI ? OFFER
			: body.url === 'https://issuer.example/.well-known/openid-credential-issuer' ? ISSUER_METADATA
				: undefined;
		return new Response(JSON.stringify({ status: data ? 200 : 404, headers: {}, data }),
			{ headers: { 'content-type': 'application/json' } });
	});
	return calls;
}
const REDIRECT = 'https://wallet.example/cb';

describe('OIDFlowWasmTransport: authorization-code issuance', () => {
	let storage: MemoryStorage;
	let proxyCalls: any[];
	beforeEach(() => {
		storage = new MemoryStorage();
		proxyCalls = stubProxy();
	});
	afterEach(() => { vi.unstubAllGlobals(); });

	it('starts the flow and resolves with the authorization step, saving the flow id for the resume', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'offer_parsed',
					payload: { credential_issuer: 'https://issuer.example', credential_configuration_ids: ['pid'] } });
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'authorization_required',
					payload: { authorization_url: 'https://as.example/authorize?x=1', state: 'st-1', code_verifier: 'cv-1' } });
				await c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://as.example/authorize?x=1' }));
				return { flow_id: p.flow_id, flow_type: 'oid4vci', wmp: {} };
			},
		});
		const lookup = vi.fn(async () => 'wallet-client-1');
		const t = transport(engine, storage, fakeWscd(), { getRegisteredClientId: lookup });
		const progress: any[] = [];
		t.onProgress((e) => progress.push(e));

		const r = await t.startOID4VCIFlow({ credentialOfferUri: OFFER_URI, redirectUri: REDIRECT });

		expect(r).toMatchObject({
			success: true,
			authorizationRequired: true,
			authorizationUrl: 'https://as.example/authorize?x=1',
			codeVerifier: 'cv-1',
			issuerState: 'st-1',
			credentialIssuerIdentifier: 'https://issuer.example',
			selectedCredentialConfigurationId: 'pid',
		});
		const start = engine.calls.find((c) => c.method === 'wmp.flow.start')!;
		expect(start.params.flow_type).toBe('oid4vci');
		// The offer was fetched once through /proxy and goes to the engine by value,
		// with the client_id the issuer's record carries; the issuer metadata
		// gave the configuration's format, which the pending authorization keeps.
		expect(proxyCalls.map((c) => c.body.url)).toEqual([
			OFFER_URI, 'https://issuer.example/.well-known/openid-credential-issuer',
		]);
		expect(lookup).toHaveBeenCalledWith('https://issuer.example');
		expect(start.params.params).toEqual({
			credential_offer: `openid-credential-offer://?credential_offer=${encodeURIComponent(OFFER_JSON)}`,
			redirect_uri: REDIRECT,
			client_id: 'wallet-client-1',
		});
		const pending = JSON.parse(storage.getItem(PENDING_AUTHORIZATION_KEY)!);
		expect(pending).toMatchObject({
			flowId: start.params.flow_id, state: 'st-1', credentialIssuer: 'https://issuer.example', format: 'mso_mdoc',
		});
		// The PKCE verifier and the state never reach the app's progress events.
		const authStep = progress.find((e) => e.stage === 'authorization_required');
		expect(authStep.payload).toEqual({ authorization_url: 'https://as.example/authorize?x=1' });
	});

	it('waits for the authorization_required notification when openAuthorization comes first', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				// The engine's notifications are asynchronous: here the call wins the race.
				const opened = c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://as.example/authorize?y=2' }));
				await new Promise((r) => setTimeout(r, 0));
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'authorization_required',
					payload: { authorization_url: 'https://as.example/authorize?y=2', state: 'st-2', code_verifier: 'cv-2' } });
				await opened;
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		expect(r).toMatchObject({
			success: true, authorizationUrl: 'https://as.example/authorize?y=2', issuerState: 'st-2', codeVerifier: 'cv-2',
		});
		expect(JSON.parse(storage.getItem(PENDING_AUTHORIZATION_KEY)!)).toMatchObject({ state: 'st-2' });
	});

	it('falls back to the engine stash when the notification never arrives', async () => {
		vi.useFakeTimers();
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				// The engine stashes the resume state in the kv before the handoff.
				await c.kv!.put(`oid4vci:auth-code:${p.flow_id}`, JSON.stringify({ code_verifier: 'cv-3', state: 'st-3', client_id: 'x' }));
				await c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://as.example/authorize?z=3' }));
				return {};
			},
		});
		const result = transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		await vi.advanceTimersByTimeAsync(2_001);
		await expect(result).resolves.toMatchObject({
			success: true, authorizationUrl: 'https://as.example/authorize?z=3', issuerState: 'st-3', codeVerifier: 'cv-3',
		});
		vi.useRealTimers();
	});

	it('refuses an authorization that is never announced', async () => {
		vi.useFakeTimers();
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				await c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://as.example/authorize' }));
				return {};
			},
		});
		const result = transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		await vi.advanceTimersByTimeAsync(2_001);
		await expect(result).resolves.toMatchObject({ success: false });
		expect(storage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
		vi.useRealTimers();
	});

	it('resumes the same flow after the redirect, signs the proof with a fresh WSCD key, and returns the credential', async () => {
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({
			flowId: 'vci-1', state: 'st-1', credentialIssuer: 'https://issuer.example', configurationId: 'pid',
			format: 'mso_mdoc', savedAt: Date.now(),
		}));
		const wscd = fakeWscd();
		const engine = fakeEngine({
			'wmp.flow.action': async (p, c) => {
				const key = await c.host.signingKey!({ flow_id: p.flow_id, fresh: false });
				const sig = await c.host.sign({ flow_id: p.flow_id, to_sign: [104, 46, 112], key_id: key.jwk.kid as string, algorithm: 'ES256' });
				expect(sig.signature).toEqual([1, 2, 3]);
				expect(key.jwk).toEqual({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'kid-1' });
				engine.notify('wmp.flow.complete', { flow_id: p.flow_id,
					result: { credential: 'eyJ.cred', deferred: false, notification_id: 'n-1', refresh_token: 'rt' } });
				return { status: 'completed' };
			},
		});
		const t = transport(engine, storage, wscd);

		const r = await t.startOID4VCIFlow({ authorizationCode: 'code-1', redirectUri: REDIRECT });

		expect(r).toEqual({
			success: true,
			flowId: 'vci-1',
			credentialIssuerIdentifier: 'https://issuer.example',
			selectedCredentialConfigurationId: 'pid',
			credentials: [{ credential: 'eyJ.cred', format: 'mso_mdoc', notification_id: 'n-1' }],
		});
		const action = engine.calls.find((c) => c.method === 'wmp.flow.action')!;
		expect(action.params).toMatchObject({
			flow_id: 'vci-1', action: 'authorization_complete', params: { code: 'code-1', state: 'st-1' },
		});
		expect(wscd.signRaw).toHaveBeenCalledWith('kid-1', new Uint8Array([104, 46, 112]));
		expect(storage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
	});

	it('leaves the format to the app when the issuer metadata cannot be read', async () => {
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ status: 500, headers: {}, data: 'down' }),
			{ headers: { 'content-type': 'application/json' } }));
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'authorization_required',
					payload: { authorization_url: 'https://as.example/a', state: 's', code_verifier: 'v' } });
				await c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://as.example/a' }));
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		expect(r.success).toBe(true);
		expect(JSON.parse(storage.getItem(PENDING_AUTHORIZATION_KEY)!).format).toBeUndefined();
	});

	it('builds the issuer metadata URL, path issuers included', () => {
		expect(issuerMetadataUrl('https://issuer.example')).toBe('https://issuer.example/.well-known/openid-credential-issuer');
		expect(issuerMetadataUrl('https://issuer.example/')).toBe('https://issuer.example/.well-known/openid-credential-issuer');
		expect(issuerMetadataUrl('https://host.example/tenant/a')).toBe('https://host.example/.well-known/openid-credential-issuer/tenant/a');
	});

	it('refuses a resume with no pending authorization', async () => {
		const t = transport(fakeEngine({}), storage);
		const r = await t.startOID4VCIFlow({ authorizationCode: 'code-1' });
		expect(r).toMatchObject({ success: false, error: { code: 'NO_PENDING_AUTHORIZATION' } });
	});

	it('does not resume a stale pending authorization', async () => {
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', savedAt: Date.now() - 2 * 3600_000 }));
		const t = transport(fakeEngine({}), storage);
		const r = await t.startOID4VCIFlow({ authorizationCode: 'code-1' });
		expect(r).toMatchObject({ success: false, error: { code: 'NO_PENDING_AUTHORIZATION' } });
	});

	it('reports the engine refusal reason (e.g. an untrusted issuer)', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': () => Promise.reject({ code: -31006, message: 'Flow error', data: { reason: 'untrusted_issuer' } }),
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		expect(r).toMatchObject({ success: false, error: { code: 'UNTRUSTED_ISSUER' } });
	});

	it('requires a redirect URI', async () => {
		const r = await transport(fakeEngine({}), storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON });
		expect(r).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
	});

	it('falls back to the unregistered client (no client_id) when the lookup fails', async () => {
		const engine = fakeEngine({ 'wmp.flow.start': async () => ({}) });
		const t = transport(engine, storage, fakeWscd(), { getRegisteredClientId: async () => { throw new Error('down'); } });
		void t.startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		await vi.waitFor(() => expect(engine.calls.some((c) => c.method === 'wmp.flow.start')).toBe(true));
		const start = engine.calls.find((c) => c.method === 'wmp.flow.start')!;
		expect(start.params.params.client_id).toBeUndefined();
		await t.disconnect();
	});

	it('refuses an offer it cannot read', async () => {
		const t = transport(fakeEngine({}), storage);
		await expect(t.startOID4VCIFlow({ credentialOffer: '{"no_issuer":1}', redirectUri: REDIRECT }))
			.resolves.toMatchObject({ success: false, error: { code: 'OFFER_UNAVAILABLE' } });
		await expect(t.startOID4VCIFlow({ credentialOfferUri: 'http://plain.example/o', redirectUri: REDIRECT }))
			.resolves.toMatchObject({ success: false, error: { code: 'OFFER_UNAVAILABLE' } });
	});

	it('refuses offers that need a transaction code', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				await c.host.txCode!(asMap({ flow_id: 'oid4vci-token' }));
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOffer: OFFER_JSON, redirectUri: REDIRECT });
		expect(r).toMatchObject({ success: false, error: { code: 'TX_CODE_UNSUPPORTED' } });
	});

	it('refuses deferred issuance', async () => {
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', savedAt: Date.now() }));
		const engine = fakeEngine({
			'wmp.flow.action': async (p) => {
				engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { credential: '', deferred: true } });
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ authorizationCode: 'c' });
		expect(r).toMatchObject({ success: false, error: { code: 'DEFERRED_UNSUPPORTED' } });
	});

	it('refuses to sign a proof when the engine never asked for its key', async () => {
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', savedAt: Date.now() }));
		const wscd = fakeWscd();
		const engine = fakeEngine({
			'wmp.flow.action': async (p, c) => {
				await c.host.sign({ flow_id: p.flow_id, to_sign: [1], key_id: null, algorithm: 'ES256' });
				return {};
			},
		});
		const r = await transport(engine, storage, wscd).startOID4VCIFlow({ authorizationCode: 'c' });
		expect(r.success).toBe(false);
		expect(r.error?.message).toMatch(/no signing key/);
		expect(wscd.signRaw).not.toHaveBeenCalled();
	});

	it('forwards the credential notification on the issuance session', async () => {
		const engine = fakeEngine({ 'wmp.flow.start': async () => ({}) });
		const t = transport(engine, storage);
		t.sendCredentialNotification('vci-1', 'n-1', 'credential_accepted');
		await vi.waitFor(() => expect(engine.calls.some((c) => c.method === 'wmp.flow.start')).toBe(true));
		const start = engine.calls.find((c) => c.method === 'wmp.flow.start')!;
		expect(start.params).toMatchObject({
			flow_type: 'credential_notification',
			wmp: { session_id: 'ses-1' },
			params: { issuance_flow_id: 'vci-1', notification_id: 'n-1', event: 'credential_accepted' },
		});
	});

	it('provides every host callback, so the adapter never builds one with new Function() (CSP)', async () => {
		const engine = fakeEngine({});
		await transport(engine, storage).connect();
		const host = engine.getConfig().host as unknown as Record<string, unknown>;
		// The callbacks engine-adapter-wasm otherwise fills with its eval-built refusal.
		for (const name of ['sign', 'match', 'consent', 'txCode', 'openAuthorization', 'vp', 'dpopProof', 'attestation']) {
			expect(typeof host[name], name).toBe('function');
		}
	});
});

const VP_REQUEST_URI = 'https://verifier.example/request/1';
const VP_CLIENT_ID = 'x509_san_dns:verifier.example';

/** The match ask as the adapter hands it: ES Maps all the way down. */
function matchAsk(flowId: string, extra: Record<string, unknown> = {}) {
	return asMap({
		flow_id: flowId,
		dcql_query: asMap({
			credentials: [asMap({ id: 'pid', format: 'dc+sd-jwt', claims: [asMap({ path: ['age_over_18'] })] })],
			credential_sets: [asMap({ options: [['pid']], purpose: 'Age check' })],
		}),
		scope: '',
		verifier: asMap({
			name: 'Shop', client_id: VP_CLIENT_ID, client_id_scheme: 'X509SanDns',
			domain: 'verifier.example', logo_uri: '', trusted: true, framework: 'etsi', reason: '',
		}),
		transaction_data: [],
		...extra,
	});
}

const SELECTED = [{
	batchId: 1,
	credentialQueryId: 'pid',
	walletCredentialRef: '42',
	credentialRaw: 'eyJ.sd-jwt~',
	holderKeyKid: 'kid-1',
	disclosedClaims: ['age_over_18'],
}];

/** One presentation run by a scripted engine; the engine's answers are recorded. */
function presentingEngine(script: (p: any, c: WasmEngineConfig, seen: Record<string, unknown>) => Promise<void>) {
	const seen: Record<string, unknown> = {};
	const engine = fakeEngine({
		'wmp.flow.start': async (p, c) => {
			await script(p, c, seen);
			return { flow_id: p.flow_id, flow_type: 'oid4vp', wmp: {} };
		},
	});
	return { engine, seen };
}

describe('OIDFlowWasmTransport: presentation', () => {
	let storage: MemoryStorage;
	beforeEach(() => { storage = new MemoryStorage(); });
	afterEach(() => { vi.useRealTimers(); });

	it('resolves at the match with the query and verifier, then presents what the user selected', async () => {
		const { engine, seen } = presentingEngine(async (p, c, seen) => {
			seen.match = await c.host.match!(matchAsk(p.flow_id));
			const handle = (seen.match as any).handle;
			seen.consent = await c.host.consent!(asMap({ flow_id: p.flow_id, purpose: '', requested_claims: ['age_over_18'], transaction_data: [] }));
			seen.vp = await c.host.vp!(asMap({
				flow_id: p.flow_id, audience: VP_CLIENT_ID, nonce: 'n-1', response_uri: 'https://verifier.example/post',
				selections: [asMap({ credential_query_id: 'pid', credential_id: '42', disclosed_claims: ['age_over_18'] })],
				verifier_jwk_thumbprint: '', transaction_data: [], selection_handle: handle,
			}));
			await c.host.openAuthorization!(asMap({ flow_id: p.flow_id, url: 'https://verifier.example/done' }));
			engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { presented: true, credential_ids: ['42'] } });
		});
		const t = transport(engine, storage);
		const sign = vi.fn(async () => ({ vpToken: '{"pid":["kb-token"]}' }));
		t.onSignRequest(sign);

		const first = await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		expect(first).toMatchObject({
			success: true,
			dcqlQuery: { credentials: [{ id: 'pid', format: 'dc+sd-jwt' }] },
			verifierInfo: { name: 'Shop', domain: 'verifier.example', purpose: 'Age check', trustedStatus: 'trusted', clientIdScheme: 'x509_san_dns' },
		});
		const start = engine.calls.find((c) => c.method === 'wmp.flow.start')!.params;
		expect(start.flow_type).toBe('oid4vp');
		const url = new URL(start.params);
		expect(url.protocol).toBe('openid4vp:');
		expect(url.searchParams.get('client_id')).toBe(VP_CLIENT_ID);
		expect(url.searchParams.get('request_uri')).toBe(VP_REQUEST_URI);

		const second = await t.startOID4VPFlow({ selectedCredentials: SELECTED });
		expect(second).toEqual({ success: true, redirectUri: 'https://verifier.example/done' });
		expect(seen.match).toMatchObject({
			selections: [{ credential_query_id: 'pid', credential_id: '42', disclosed_claims: ['age_over_18'] }],
			handle: expect.any(String),
		});
		expect(seen.consent).toEqual({ consented: true });
		expect(seen.vp).toEqual({ vp_token: '{"pid":["kb-token"]}' });
		expect(sign).toHaveBeenCalledWith(expect.objectContaining({
			action: 'sign_presentation',
			params: expect.objectContaining({
				audience: VP_CLIENT_ID,
				nonce: 'n-1',
				responseUri: 'https://verifier.example/post',
				credentialsToInclude: [{ credentialId: '42', credentialQueryId: 'pid', disclosedClaims: ['age_over_18'], credentialRaw: 'eyJ.sd-jwt~' }],
			}),
		}));
	});

	it('refuses a vp ask that does not match the selection', async () => {
		const { engine, seen } = presentingEngine(async (p, c, seen) => {
			const match: any = await c.host.match!(matchAsk(p.flow_id));
			const ask = (extra: Record<string, unknown>) => asMap({
				flow_id: p.flow_id, audience: 'a', nonce: 'n', response_uri: 'r', transaction_data: [],
				selections: [asMap({ credential_query_id: 'pid', credential_id: '42', disclosed_claims: [] })],
				selection_handle: match.handle, ...extra,
			});
			seen.wrongHandle = await c.host.vp!(ask({ selection_handle: 'forged' })).catch((e) => e.message);
			seen.otherCredential = await c.host.vp!(ask({
				selections: [asMap({ credential_query_id: 'pid', credential_id: '7', disclosed_claims: [] })],
			})).catch((e) => e.message);
			seen.otherQuery = await c.host.vp!(ask({
				selections: [asMap({ credential_query_id: 'email', credential_id: '42', disclosed_claims: [] })],
			})).catch((e) => e.message);
			seen.moreClaims = await c.host.consent!(asMap({ flow_id: p.flow_id, purpose: '', requested_claims: ['age_over_18', 'family_name'], transaction_data: [] }));
			engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { declined: true } });
		});
		const t = transport(engine, storage);
		const sign = vi.fn(async () => ({ vpToken: 'x' }));
		t.onSignRequest(sign);

		await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		const r = await t.startOID4VPFlow({ selectedCredentials: SELECTED });
		expect(r).toMatchObject({ success: false, error: { code: 'PRESENTATION_DECLINED' } });
		expect(seen.wrongHandle).toMatch(/selection handle/);
		expect(seen.otherCredential).toMatch(/was not selected/);
		expect(seen.otherQuery).toMatch(/was not selected/);
		expect(seen.moreClaims).toEqual({ consented: false });
		expect(sign).not.toHaveBeenCalled();
	});

	it('answers the match with nothing when no credential matches', async () => {
		const { engine, seen } = presentingEngine(async (p, c, seen) => {
			seen.match = await c.host.match!(matchAsk(p.flow_id));
			engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { matched: false, refused: true } });
		});
		const t = transport(engine, storage);
		expect(await t.reportNoMatchingCredentials()).toBeNull(); // nothing open yet

		await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		const r = await t.reportNoMatchingCredentials();
		expect(r).toMatchObject({ success: false, error: { code: 'NO_MATCHING_CREDENTIALS' } });
		expect(seen.match).toEqual({ selections: [] });
	});

	it('declines a match nobody answers, so the verifier is not left waiting', async () => {
		vi.useFakeTimers();
		let answered: unknown;
		const { engine } = presentingEngine(async (p, c) => {
			answered = await c.host.match!(matchAsk(p.flow_id));
		});
		const t = transport(engine, storage);
		const first = t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		await vi.advanceTimersByTimeAsync(0);
		await expect(first).resolves.toMatchObject({ success: true });
		await vi.advanceTimersByTimeAsync(3 * 60_000 + 1);
		expect(answered).toEqual({ selections: [] });
	});

	it('declines a presentation left open when a new one starts', async () => {
		const answers: unknown[] = [];
		const { engine } = presentingEngine(async (p, c) => {
			answers.push(await c.host.match!(matchAsk(p.flow_id)));
		});
		const t = transport(engine, storage);
		await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		expect(answers).toEqual([{ selections: [] }]);
	});

	it('refuses requests with transaction data before the user selects anything', async () => {
		let answered: unknown;
		const { engine } = presentingEngine(async (p, c) => {
			answered = await c.host.match!(matchAsk(p.flow_id, { transaction_data: ['eyJ0eXBlIjoicGF5bWVudCJ9'] }));
		});
		const r = await transport(engine, storage).startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		expect(r).toMatchObject({ success: false, error: { code: 'TRANSACTION_DATA_UNSUPPORTED' } });
		expect(answered).toEqual({ selections: [] });
	});

	it('reports the engine refusal reason (e.g. an untrusted verifier)', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': async () => Promise.reject({ code: -31006, message: 'flow error', data: { reason: 'untrusted_verifier', verifier: VP_CLIENT_ID } }),
		});
		const r = await transport(engine, storage).startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		expect(r).toMatchObject({ success: false, error: { code: 'UNTRUSTED_VERIFIER', details: { verifier: VP_CLIENT_ID } } });
	});

	it('refuses a selection when no presentation is waiting for one', async () => {
		const r = await transport(fakeEngine({}), storage).startOID4VPFlow({ selectedCredentials: SELECTED });
		expect(r).toMatchObject({ success: false, error: { code: 'NO_PRESENTATION_IN_PROGRESS' } });
	});
});

describe('wasmPorts', () => {
	it('toPlain turns the adapter\'s ES Maps into plain objects, deeply', () => {
		const v = toPlain(new Map<string, unknown>([
			['flow_id', 'f'],
			['ctx', new Map([['a', [new Map([['b', 1]])]]])],
		]));
		expect(v).toEqual({ flow_id: 'f', ctx: { a: [{ b: 1 }] } });
		expect(toPlain({ x: new Map([['y', 2]]) })).toEqual({ x: { y: 2 } });
		expect(toPlain([1, 'a', null])).toEqual([1, 'a', null]);
		const bytes = new Uint8Array([1]);
		expect(toPlain(bytes)).toBe(bytes);
	});

	it('parses the key material forms the engine sends', () => {
		const enc = (s: string) => Array.from(new TextEncoder().encode(s));
		const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
		expect(parseKeyMaterial(enc(`${b64u({ alg: 'ES256', x5c: ['MIIB'] })}.${b64u({})}.sig`))).toEqual({ type: 'x5c', key: ['MIIB'] });
		expect(parseKeyMaterial(enc('["MIIA","MIIB"]'))).toEqual({ type: 'x5c', key: ['MIIA', 'MIIB'] });
		expect(parseKeyMaterial(enc('{"keys":[{"kty":"EC"}]}'))).toEqual({ type: 'jwk', key: [{ kty: 'EC' }] });
		expect(parseKeyMaterial(enc('{"kty":"EC"}'))).toEqual({ type: 'jwk', key: { kty: 'EC' } });
		expect(parseKeyMaterial(enc('https://issuer.example/jwks'))).toBeUndefined();
		expect(parseKeyMaterial([])).toBeUndefined();
	});

	it('the PDP asks the issuer or verifier evaluator, refuses other subjects, and fails closed', async () => {
		const evaluators = {
			evaluateIssuerTrust: vi.fn(async () => ({ trusted: true, status: 'trusted' })),
			evaluateVerifierTrust: vi.fn(async () => ({ trusted: true, status: 'trusted', metadata: { reason: 'listed' } })),
		} as unknown as TrustEvaluators;
		const pdp = createTrustPdp(evaluators);
		await expect(pdp.evaluate({ subject: 'https://i', key_material: [], resource_type: 'credential-issuer' }))
			.resolves.toMatchObject({ trusted: true });
		expect(evaluators.evaluateIssuerTrust).toHaveBeenCalledWith(expect.objectContaining({ issuerId: 'https://i' }));

		const x5c = Array.from(new TextEncoder().encode('["MIIA"]'));
		await expect(pdp.evaluate({
			subject: 'x509_san_dns:v.example', key_material: x5c, resource_type: 'credential-verifier',
			context: { client_id_scheme: 'x509_san_dns', response_uri: 'https://v.example/post' },
		})).resolves.toEqual({ trusted: true, decision: 'listed' });
		expect(evaluators.evaluateVerifierTrust).toHaveBeenCalledWith({
			clientIdScheme: { scheme: 'x509_san_dns', clientId: 'x509_san_dns:v.example', identifier: 'v.example' },
			keyMaterial: { type: 'x5c', key: ['MIIA'] },
			responseUri: 'https://v.example/post',
		});
		await pdp.evaluate({
			subject: 'decentralized_identifier:did:web:v.example', key_material: [], resource_type: 'credential-verifier',
			context: { client_id_scheme: 'decentralized_identifier' },
		});
		expect(evaluators.evaluateVerifierTrust).toHaveBeenLastCalledWith(expect.objectContaining({
			clientIdScheme: { scheme: 'did', clientId: 'decentralized_identifier:did:web:v.example', identifier: 'did:web:v.example' },
			keyMaterial: { type: 'kid', key: '' },
		}));

		await expect(pdp.evaluate({ subject: 'd', key_material: [], resource_type: 'did-document' }))
			.resolves.toMatchObject({ trusted: false });
		(evaluators.evaluateIssuerTrust as any).mockRejectedValueOnce(new Error('pdp down'));
		await expect(pdp.evaluate({ subject: 'https://i', key_material: [] })).resolves.toEqual({ trusted: false, decision: 'pdp down' });
	});

	it('the kv expires old entries and drops malformed ones', async () => {
		const storage = new MemoryStorage();
		let now = 1_000;
		const kv = createStorageKv(storage, () => now);
		await kv.put('a', 'v');
		await expect(kv.get('a')).resolves.toBe('v');
		now += 2 * 3600_000;
		await expect(kv.get('a')).resolves.toBeNull();
		storage.setItem('wasm-engine:b', 'not json');
		await expect(kv.get('b')).resolves.toBeNull();
		await kv.put('c', 'x');
		await kv.del('c');
		await expect(kv.get('c')).resolves.toBeNull();
	});

	it('the proxy fetch maps the envelope and caps the advertised batch size', async () => {
		const calls: any[] = [];
		vi.stubGlobal('fetch', async (url: string, init: any) => {
			calls.push({ url, init });
			return new Response(JSON.stringify({
				status: 200, headers: { 'DPoP-Nonce': 'n1' },
				data: { credential_issuer: 'https://i', batch_credential_issuance: { batch_size: 50 } },
			}), { headers: { 'content-type': 'application/json' } });
		});
		const f = createProxyFetch({ backendUrl: 'https://be', getAuthToken: () => 'tok', tenantId: 't1' });
		const r = await f({ method: 'GET', url: 'https://i/.well-known/openid-credential-issuer', headers: ['accept', 'application/json'], body: [] });
		expect(calls[0].url).toBe('https://be/proxy');
		expect(JSON.parse(calls[0].init.body)).toEqual({ url: 'https://i/.well-known/openid-credential-issuer', method: 'GET', headers: { accept: 'application/json' } });
		expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Tenant-ID': 't1' });
		expect(r.headers).toEqual(['dpop-nonce', 'n1']);
		expect(JSON.parse(new TextDecoder().decode(new Uint8Array(r.body)))).toEqual({
			credential_issuer: 'https://i', batch_credential_issuance: { batch_size: 1 },
		});
		vi.unstubAllGlobals();
	});

	it('the client_id lookup reads only the public clientId of the matching issuer record', async () => {
		const calls: any[] = [];
		vi.stubGlobal('fetch', async (url: string, init: any) => {
			calls.push({ url, init });
			return new Response(JSON.stringify([
				{ credentialIssuerIdentifier: 'https://other.example', clientId: 'x' },
				{ credentialIssuerIdentifier: 'https://issuer.example/', clientId: 'wallet-client-1', clientJwk: '{"d":"secret"}' },
			]), { headers: { 'content-type': 'application/json' } });
		});
		const lookup = createRegisteredClientIdLookup({ backendUrl: 'https://be', tenantId: 't1', getAuthToken: () => 'tok' });
		await expect(lookup('https://issuer.example')).resolves.toBe('wallet-client-1');
		await expect(lookup('https://unknown.example')).resolves.toBeUndefined();
		expect(calls[0].url).toBe('https://be/issuer/all');
		expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Tenant-ID': 't1' });
		vi.unstubAllGlobals();
	});

	it('the proxy fetch throws when the backend itself refuses', async () => {
		vi.stubGlobal('fetch', async () => new Response('{"error":"Invalid token"}', { status: 401, headers: { 'content-type': 'application/json' } }));
		const f = createProxyFetch({ backendUrl: 'https://be', getAuthToken: () => 't', tenantId: 'd' });
		await expect(f({ method: 'GET', url: 'https://x', headers: [], body: [] })).rejects.toThrow(/proxy 401/);
		vi.unstubAllGlobals();
	});
});

describe('WasmEngine', () => {
	// The generated package is not in git; a build without it must still load,
	// and the engine must say why it cannot start.
	it('fails to start with a clear error when the engine package is not built', async () => {
		await expect(createWasmEngine({} as WasmEngineConfig)).rejects.toThrow(/not part of this build/);
	});
});