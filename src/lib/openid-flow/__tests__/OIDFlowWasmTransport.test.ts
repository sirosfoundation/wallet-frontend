import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OIDFlowWasmTransport, PENDING_AUTHORIZATION_KEY, issuerMetadataUrl } from '../transports/OIDFlowWasmTransport';
import { createWasmEngine, toPlain, type WasmEngine, type WasmEngineConfig } from '../wasm/WasmEngine';

import { UnreachableFromBrowserError, clearWasmEngineStorage, createDirectFetch, createRegisteredClientIdLookup, createStorageKv, createTrustPdp, parseKeyMaterial } from '../wasm/wasmPorts';
import type { TrustEvaluators } from '../types';
import type { IWscdManagerClient } from '@/lib/wscd-manager';

// vi.mock is hoisted above the imports.

const enginePkg = vi.hoisted(() => ({
	init: vi.fn(async () => ({})),
	created: [] as unknown[],
}));

vi.mock('@sirosfoundation/siros-wallet-core', () => ({
	default: enginePkg.init,
	WasmEngine: class {
		constructor(config: unknown) { enginePkg.created.push(config); }
		request = vi.fn();
	},
}));

vi.mock('@sirosfoundation/siros-wallet-core/engine_adapter_wasm_bg.wasm?url', () => ({
	default: '/assets/engine_adapter_wasm_bg.wasm',
}));

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
		signOpenid4vciProofJwt: vi.fn(async () => new Uint8Array([1, 2, 3])),
	} as unknown as IWscdManagerClient & { generateKeypairs: ReturnType<typeof vi.fn>; signOpenid4vciProofJwt: ReturnType<typeof vi.fn> };
	
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

/** The issuer, fetched directly from the page: the credential offer and its metadata. */
function stubIssuer() {
	const calls: any[] = [];
	vi.stubGlobal('fetch', async (url: string, init: any) => {
		calls.push({ url, init });
		const data = url === OFFER_URI ? OFFER
			: url === 'https://issuer.example/.well-known/openid-credential-issuer' ? ISSUER_METADATA
				: undefined;
		return new Response(data ? JSON.stringify(data) : 'not found',
			{ status: data ? 200 : 404, headers: { 'content-type': data ? 'application/json' : 'text/plain' } });
	});
	return calls;
}
const REDIRECT = 'https://wallet.example/cb';

describe('OIDFlowWasmTransport: authorization-code issuance', () => {
	let storage: MemoryStorage;
	let issuerCalls: any[];
	beforeEach(() => {
		storage = new MemoryStorage();
		issuerCalls = stubIssuer();
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
		// The offer was fetched once, straight from the issuer (nothing through
		// the backend), and goes to the engine by value,
		// gave the configuration's format, which the pending authorization keeps.
		expect(issuerCalls.map((c) => c.url)).toEqual([
			OFFER_URI, 'https://issuer.example/.well-known/openid-credential-issuer',
		]);
		for (const call of issuerCalls) {
			expect(call.init.headers).not.toHaveProperty('Authorization');
			expect(call.init.credentials).toBe('omit');
		}
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
		expect(wscd.signOpenid4vciProofJwt).toHaveBeenCalledWith('kid-1', 'h.p');
		expect(storage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
	});

	it('leaves the format to the app when the issuer metadata cannot be read', async () => {
		vi.stubGlobal('fetch', async () => new Response('down', { status: 500, headers: { 'content-type': 'text/plain' } }));
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

		it('fails as unreachable from the browser when the issuer cannot be fetched (no CORS)', async () => {
		vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
		const engine = fakeEngine({});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOfferUri: OFFER_URI, redirectUri: REDIRECT });
		expect(r).toMatchObject({ success: false, error: { code: 'UNREACHABLE_FROM_BROWSER' } });
		expect(r.error?.message).toMatch(/issuer\.example could not be reached from the browser.*remote engine/);
		expect(engine.calls.find((c) => c.method === 'wmp.flow.start')).toBeUndefined();
	});

	it('reports a flow the engine ended over an unreachable host as unreachable from the browser', async () => {
		let reachable = true;
		vi.stubGlobal('fetch', async (url: string) => {
			if (!reachable) throw new TypeError('Failed to fetch');
			return new Response(JSON.stringify(url === OFFER_URI ? OFFER : ISSUER_METADATA), { headers: { 'content-type': 'application/json' } });
		});
		const engine = fakeEngine({
			'wmp.flow.start': async (p, c) => {
				reachable = false;
				await c.fetch({ method: 'POST', url: 'https://as.example/token', headers: [], body: [] }).catch(() => {});
				engine.notify('wmp.flow.error', { flow_id: p.flow_id, code: -31006, message: 'request failed' });
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ credentialOfferUri: OFFER_URI, redirectUri: REDIRECT });
		expect(r).toMatchObject({ success: false, error: { code: 'UNREACHABLE_FROM_BROWSER' } });
		expect(r.error?.message).toMatch(/as\.example could not be reached/);
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

	describe('pre-authorized offers', () => {
		const PRE_AUTH = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';
		const offerWith = (txCode?: Record<string, unknown>) => JSON.stringify({
			credential_issuer: 'https://issuer.example',
			credential_configuration_ids: ['pid'],
			grants: { [PRE_AUTH]: { 'pre-authorized_code': 'pac-1', ...(txCode ? { tx_code: txCode } : {}) } },
		});
		/** The engine's pre-authorized flow: the tx_code ask (when any), then the credential. */
		function preAuthEngine(askTxCode: boolean, seen: { code?: unknown } = {}) {
			const engine = fakeEngine({
				'wmp.flow.start': async (p, c) => {
					if (askTxCode) {
						// The engine asks with the token step's id, not the flow's.
						seen.code = await c.host.txCode!(asMap({ flow_id: 'oid4vci-token' })).catch((e: Error) => `rejected: ${e.message}`);
						if (String(seen.code).startsWith('rejected')) return {};
					}
					engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { credential: 'eyJ.pre', deferred: false } });
					return {};
				},
			});
			return engine;
		}

		it('resolves at the tx_code ask with the PIN description, then issues with the code the user typed', async () => {
			const seen: { code?: unknown } = {};
			const t = transport(preAuthEngine(true, seen), storage);
			const first = await t.startOID4VCIFlow({
				credentialOffer: offerWith({ input_mode: 'numeric', length: 6, description: 'The PIN from the letter' }),
				redirectUri: REDIRECT,
			});
			expect(first).toMatchObject({
				success: true,
				preAuthorizedCode: 'pac-1',
				txCode: { inputMode: 'numeric', length: 6, description: 'The PIN from the letter' },
			});
			expect(first.credentials).toBeUndefined();

			const second = await t.startOID4VCIFlow({ preAuthorizedCode: 'pac-1', txCodeInput: '123456' });
			expect(seen.code).toBe('123456');
			expect(second).toMatchObject({
				success: true,
				credentials: [{ credential: 'eyJ.pre', format: 'mso_mdoc' }],
				credentialIssuerIdentifier: 'https://issuer.example',
			});
		});

		it('issues straight away when the offer needs no transaction code', async () => {
			const r = await transport(preAuthEngine(false), storage).startOID4VCIFlow({ credentialOffer: offerWith(), redirectUri: REDIRECT });
			expect(r).toMatchObject({ success: true, credentials: [{ credential: 'eyJ.pre' }] });
			expect(r.txCode).toBeUndefined();
		});

		it('declines the ask when the prompt is cancelled', async () => {
			const seen: { code?: unknown } = {};
			const t = transport(preAuthEngine(true, seen), storage);
			await t.startOID4VCIFlow({ credentialOffer: offerWith({ length: 4 }), redirectUri: REDIRECT });
			const r = await t.startOID4VCIFlow({ preAuthorizedCode: 'pac-1' });
			expect(r).toMatchObject({ success: false, error: { code: 'TX_CODE_DECLINED' } });
			expect(seen.code).toMatch(/^rejected/);
		});

		it('declines an ask nobody answers, so the flow does not hang', async () => {
			vi.useFakeTimers();
			const seen: { code?: unknown } = {};
			const t = transport(preAuthEngine(true, seen), storage);
			const first = t.startOID4VCIFlow({ credentialOffer: offerWith({ length: 4 }), redirectUri: REDIRECT });
			await vi.advanceTimersByTimeAsync(0);
			await expect(first).resolves.toMatchObject({ success: true, preAuthorizedCode: 'pac-1' });
			await vi.advanceTimersByTimeAsync(3 * 60_000 + 1);
			expect(seen.code).toMatch(/^rejected/);
			vi.useRealTimers();
		});
		
		it('releases the flow in progress: cancels it in the engine and refuses a late signature for it', async () => {
			const engine = preAuthEngine(true);
			const t = transport(engine, storage);
			const first = await t.startOID4VCIFlow({ credentialOffer: offerWith({ length: 6 }), redirectUri: REDIRECT });
			expect(first.txCode).toBeTruthy();
			const flowId = engine.calls.find((c) => c.method === 'wmp.flow.start')!.params.flow_id;

			t.releaseFlow();
			await new Promise((r) => setTimeout(r, 0));
			expect(engine.calls).toContainEqual(expect.objectContaining({
				method: 'wmp.flow.cancel', params: expect.objectContaining({ flow_id: flowId, reason: 'released' }),
			}));
			// The ask was declined, so the code the user types next has nowhere to go.
			const second = await t.startOID4VCIFlow({ preAuthorizedCode: 'pac-1', txCodeInput: '123456' });
			expect(second).toMatchObject({ success: false, error: { code: 'NO_TX_CODE_REQUEST' } });

			const host = engine.getConfig().host;
			await expect(host.sign!(asMap({ flow_id: flowId, to_sign: [1], algorithm: 'ES256', key_id: 'kid-1' })))
				.rejects.toThrow('The flow was released locally');
		});

		it('answers a call still waiting on the released flow', async () => {
			const engine = fakeEngine({ 'wmp.flow.start': async () => ({}) });
			const t = transport(engine, storage);
			const pending = t.startOID4VCIFlow({ credentialOffer: offerWith(), redirectUri: REDIRECT });
			await new Promise((r) => setTimeout(r, 20));
			t.releaseFlow();
			await expect(pending).resolves.toMatchObject({ success: false, error: { code: 'RELEASED' } });
		});

		it('refuses a code when no issuance is waiting for one', async () => {
			const r = await transport(fakeEngine({}), storage).startOID4VCIFlow({ preAuthorizedCode: 'pac-1', txCodeInput: '1' });
			expect(r).toMatchObject({ success: false, error: { code: 'NO_TX_CODE_REQUEST' } });
		});
	});

	it('waits through the engine\'s deferred polling and returns the credential when it arrives', async () => {
		vi.useFakeTimers();
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', format: 'dc+sd-jwt', savedAt: Date.now() }));
		const engine = fakeEngine({
			'wmp.flow.action': async (p) => {
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'deferred',
					payload: { transaction_id: 'tx-9', interval: 5, max_attempts: 60 } });
				// The issuer is ready after four minutes: past the usual 3-minute step.
				await new Promise((r) => setTimeout(r, 4 * 60_000));
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'deferred_credential_received', payload: { has_credential: true } });
				engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { credential: 'eyJ.late', deferred: false } });
				return {};
			},
		});
		const result = transport(engine, storage).startOID4VCIFlow({ authorizationCode: 'c' });
		await vi.advanceTimersByTimeAsync(4 * 60_000 + 1);
		await expect(result).resolves.toMatchObject({ success: true, credentials: [{ credential: 'eyJ.late', format: 'dc+sd-jwt' }] });
		vi.useRealTimers();
	});

	it('still times out when deferred polling outlasts the engine\'s budget', async () => {
		vi.useFakeTimers();
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', savedAt: Date.now() }));
		const engine = fakeEngine({
			'wmp.flow.action': async (p) => {
				engine.notify('wmp.flow.progress', { flow_id: p.flow_id, step: 'deferred', payload: { interval: 1, max_attempts: 10 } });
				return new Promise(() => {}); // never completes
			},
		});
		const result = transport(engine, storage).startOID4VCIFlow({ authorizationCode: 'c' });
		// The budget (10 s) plus the step margin (3 min).
		await vi.advanceTimersByTimeAsync(10_000 + 3 * 60_000 + 1);
		await expect(result).resolves.toMatchObject({ success: false, error: { code: 'TIMEOUT' } });
		vi.useRealTimers();
	});

	it('reports a deferred credential that never arrived', async () => {
		storage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ flowId: 'vci-1', state: 's', savedAt: Date.now() }));
		const engine = fakeEngine({
			'wmp.flow.action': async (p) => {
				engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { credential: '', deferred: true } });
				return {};
			},
		});
		const r = await transport(engine, storage).startOID4VCIFlow({ authorizationCode: 'c' });
		expect(r).toMatchObject({ success: false, error: { code: 'DEFERRED_NOT_READY' } });
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
		expect(wscd.signOpenid4vciProofJwt).not.toHaveBeenCalled();
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

	describe('transaction data', () => {
		const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		const PAYMENT = b64({ type: 'payment', credential_ids: ['pid'], amount: '10 EUR' });
		const ORPHAN = b64({ type: 'payment', credential_ids: ['mdl'], amount: '5 EUR' });

		/** One presentation: the request carries `requestData`, the engine's vp ask `vpData`. */
		async function run(requestData: string[], vpData?: string[], sign = vi.fn(async () => ({ vpToken: '{"pid":["t"]}' }))) {
			const built = presentingEngine(async (p, c, seen) => {
				const match: any = await c.host.match!(matchAsk(p.flow_id, { transaction_data: requestData }));
				seen.vp = await c.host.vp!(asMap({
					flow_id: p.flow_id, audience: VP_CLIENT_ID, nonce: 'n', response_uri: 'https://verifier.example/post',
					selections: [asMap({ credential_query_id: 'pid', credential_id: '42', disclosed_claims: ['age_over_18'] })],
					transaction_data: vpData ?? requestData, selection_handle: match.handle,
				})).catch((e: Error) => `threw: ${e.message}`);
				built.engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: { presented: true } });
			});
			const t = transport(built.engine, storage);
			t.onSignRequest(sign);
			const first = await t.startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
			await t.startOID4VPFlow({ selectedCredentials: SELECTED });
			return { first, seen: built.seen, sign };
		}

		it('shows the entries for consent and hands each credential the entries that name it', async () => {
			const { first, seen, sign } = await run([PAYMENT]);
			expect(first).toMatchObject({
				success: true,
				transactionData: [{ type: 'payment', data: { heading: 'payment', text: 'amount: 10 EUR' } }],
			});
			expect(seen.vp).toEqual({ vp_token: '{"pid":["t"]}' });
			expect(sign).toHaveBeenCalledWith(expect.objectContaining({
				params: expect.objectContaining({
					credentialsToInclude: [expect.objectContaining({ credentialQueryId: 'pid', transactionData: [PAYMENT] })],
				}),
			}));
		});

		it('refuses to the verifier an entry no presented credential can carry', async () => {
			const { seen, sign } = await run([PAYMENT, ORPHAN]);
			expect(seen.vp).toEqual({ vp_token: '', refusal: { code: 'UNSUPPORTED_TRANSACTION_DATA' } });
			expect(sign).not.toHaveBeenCalled();
		});

		it('refuses a vp ask whose transaction data is not what the user approved', async () => {
			const { seen, sign } = await run([PAYMENT], [ORPHAN]);
			expect(seen.vp).toMatch(/differs from the request/);
			expect(sign).not.toHaveBeenCalled();
		});

		it('refuses to the verifier when the signer cannot bind the entries', async () => {
			const refusing = vi.fn(async () => { throw Object.assign(new Error('mdoc'), { code: 'UNSUPPORTED_TRANSACTION_DATA' }); });
			const { seen } = await run([PAYMENT], undefined, refusing);
			expect(seen.vp).toEqual({ vp_token: '', refusal: { code: 'UNSUPPORTED_TRANSACTION_DATA' } });
		});

		it('ends the presentation on an entry it cannot read, before the user selects anything', async () => {
			let answered: unknown;
			const { engine } = presentingEngine(async (p, c) => {
				answered = await c.host.match!(matchAsk(p.flow_id, { transaction_data: ['not-json'] }));
			});
			const r = await transport(engine, storage).startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
			expect(r).toMatchObject({ success: false, error: { code: 'TRANSACTION_DATA_INVALID' } });
			expect(answered).toEqual({ selections: [] });
		});
	});

	it('reports the engine refusal reason (e.g. an untrusted verifier)', async () => {
		const engine = fakeEngine({
			'wmp.flow.start': async () => Promise.reject({ code: -31006, message: 'flow error', data: { reason: 'untrusted_verifier', verifier: VP_CLIENT_ID } }),
		});
		const r = await transport(engine, storage).startOID4VPFlow({ requestUriRef: VP_REQUEST_URI, clientId: VP_CLIENT_ID });
		expect(r).toMatchObject({ success: false, error: { code: 'UNTRUSTED_VERIFIER', details: { verifier: VP_CLIENT_ID } } });
	});

	describe('Digital Credentials API', () => {
		const ORIGIN = 'https://shop.example';
		const DC_REQUEST = { nonce: 'n-1', dcql_query: { credentials: [{ id: 'pid', format: 'dc+sd-jwt' }] }, response_mode: 'dc_api' };

		/** A DC API presentation: the engine completes with the given result after the vp ask. */
		function dcEngine(complete: Record<string, unknown>) {
			const built = presentingEngine(async (p, c, seen) => {
				const match: any = await c.host.match!(matchAsk(p.flow_id));
				seen.vp = await c.host.vp!(asMap({
					flow_id: p.flow_id, audience: `origin:${ORIGIN}`, nonce: 'n-1', response_uri: '', origin: ORIGIN,
					selections: [asMap({ credential_query_id: 'pid', credential_id: '42', disclosed_claims: ['age_over_18'] })],
					transaction_data: [], selection_handle: match.handle,
				}));
				built.engine.notify('wmp.flow.complete', { flow_id: p.flow_id, result: complete });
			});
			return built;
		}

		it('starts on the DC API request with the origin, signs for the origin, and returns the engine\'s response', async () => {
			const { engine } = dcEngine({ presented: true, dc_api_response: { vp_token: '{"pid":["kb"]}' } });
			const t = transport(engine, storage);
			const sign = vi.fn(async () => ({ vpToken: '{"pid":["kb"]}' }));
			t.onSignRequest(sign);

			const first = await t.startDCAPIPresentation({ request: DC_REQUEST, origin: ORIGIN });
			expect(first).toMatchObject({ success: true, verifierInfo: { name: 'Shop' } });
			expect(engine.calls.find((c) => c.method === 'wmp.flow.start')!.params.params).toEqual({ ...DC_REQUEST, origin: ORIGIN });

			const second = await t.startOID4VPFlow({ selectedCredentials: SELECTED });
			// The DCQL object, not its JSON text, goes back through the channel.
			expect(second).toEqual({ success: true, dcApiResponse: { vp_token: { pid: ['kb'] } } });
			expect(sign).toHaveBeenCalledWith(expect.objectContaining({
				params: expect.objectContaining({ origin: ORIGIN, responseUri: undefined, audience: `origin:${ORIGIN}` }),
			}));
		});

		it('passes an encrypted response and a refusal through as they are', async () => {
			const encrypted = dcEngine({ presented: true, dc_api_response: { response: 'eyJhbGciOi.jwe' } });
			const t1 = transport(encrypted.engine, storage);
			t1.onSignRequest(async () => ({ vpToken: '{}' }));
			await t1.startDCAPIPresentation({ request: DC_REQUEST, origin: ORIGIN });
			expect(await t1.startOID4VPFlow({ selectedCredentials: SELECTED }))
				.toEqual({ success: true, dcApiResponse: { response: 'eyJhbGciOi.jwe' } });

			const refusal = { error: 'invalid_transaction_data', error_description: 'The wallet did not fulfil the request' };
			const refused = dcEngine({ declined: true, dc_api_response: refusal });
			const t2 = transport(refused.engine, storage);
			t2.onSignRequest(async () => ({ vpToken: '{}' }));
			await t2.startDCAPIPresentation({ request: DC_REQUEST, origin: ORIGIN });
			expect(await t2.startOID4VPFlow({ selectedCredentials: SELECTED }))
				.toMatchObject({ success: false, error: { code: 'PRESENTATION_DECLINED' }, dcApiResponse: refusal });
		});

		it('needs the caller\'s origin', async () => {
			const r = await transport(fakeEngine({}), storage).startDCAPIPresentation({ request: DC_REQUEST, origin: '' });
			expect(r).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
		});
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
			keyMaterial: { type: 'resolution', key: [] },
		}));
		// A Digital Credentials API origin: the wallet's own client_id parser.
		await pdp.evaluate({
			subject: 'https://shop.example', key_material: [], resource_type: 'credential-verifier',
			context: { client_id_scheme: 'redirect_uri' },
		});
		expect(evaluators.evaluateVerifierTrust).toHaveBeenLastCalledWith(expect.objectContaining({
			clientIdScheme: expect.objectContaining({ scheme: 'https', clientId: 'https://shop.example' }),
			keyMaterial: { type: 'resolution', key: [] },
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

	it('logout clears the engine\'s stored flow state and pending authorization, and nothing else', async () => {
		const storage = new MemoryStorage();
		const kv = createStorageKv(storage);
		await kv.put('flow-1', 'state');
		await kv.put('flow-2', 'state');
		storage.setItem(PENDING_AUTHORIZATION_KEY, '{"flowId":"vci-1"}');
		storage.setItem('unrelated', 'keep');

		clearWasmEngineStorage(storage);

		await expect(kv.get('flow-1')).resolves.toBeNull();
		await expect(kv.get('flow-2')).resolves.toBeNull();
		expect(storage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
		expect(storage.getItem('unrelated')).toBe('keep');
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
});

describe('WasmEngine', () => {
	// The engine comes from the npm package: its JS module, and its .wasm as a
	// bundled asset URL. Booting compiles the .wasm once per page.
	it('boots the npm package once, with the bundled .wasm, and builds engines over the config', async () => {
		const config = { host: {} } as unknown as WasmEngineConfig;
		const first = await createWasmEngine(config);
		const second = await createWasmEngine(config);

		expect(enginePkg.init).toHaveBeenCalledTimes(1);
		expect(enginePkg.init).toHaveBeenCalledWith({ module_or_path: '/assets/engine_adapter_wasm_bg.wasm' });
		expect(enginePkg.created).toEqual([config, config]);
		expect(first).not.toBe(second);
	});
});
