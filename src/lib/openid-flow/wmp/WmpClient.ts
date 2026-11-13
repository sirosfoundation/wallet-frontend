/**
 * WMP client over the HTTPS binding (WMP Transport Section 4): JSON-RPC 2.0
 * requests are POSTed to the rpc endpoint, and the server's messages
 * (notifications and server-initiated requests such as a sign sub-flow's
 * wmp.flow.start) arrive on the SSE stream at `<rpc>/events`.
 *
 * The stream is read with fetch rather than EventSource, because EventSource
 * cannot send the Authorization header.
 *
 * Reconnection follows Transport Section 4.3: a dropped stream is reopened
 * with Last-Event-ID; when the server answers 410 Gone (the cursor left the
 * replay window) the session is resumed with wmp.session.resume (Core 4.5)
 * and the stream reopened. Events are de-duplicated by their numeric ID.
 */

import { logger } from '@/logger';

export const WMP_VERSION = '0.1';

export interface WmpRpcErrorBody {
	code: number;
	message: string;
	data?: unknown;
}

/** A JSON-RPC error answered by the server (or an HTTP failure, code 0). */
export class WmpRpcError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = 'WmpRpcError';
		this.code = code;
		this.data = data;
	}
}

export interface WmpMessage {
	jsonrpc: '2.0';
	id?: string | number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: WmpRpcErrorBody;
}

export type WmpCapabilities = Record<string, unknown>;

export type WmpNotificationHandler = (method: string, params: Record<string, unknown>) => void;

/** Answers a server-initiated request; the resolved value is the JSON-RPC result. */
export type WmpRequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface WmpClientOptions {
	/** Defaults to `${rpcUrl}/events`, the URL go-wmp's server serves the stream at. */
	eventsUrl?: string;
	/** Session TTL requested at creation (seconds). The server caps it. */
	ttlSeconds?: number;
	fetchImpl?: typeof fetch;
}

const MAX_STREAM_RECONNECTS = 5;
const STREAM_RECONNECT_BASE_MS = 1000;

export class WmpClient {
	private readonly rpcUrl: string;
	private readonly eventsUrl: string;
	private readonly ttlSeconds?: number;
	private readonly fetchImpl: typeof fetch;
	private getToken: () => string;

	private sessionId: string | null = null;
	private resumptionToken: string | null = null;
	private negotiated: WmpCapabilities = {};
	private version = WMP_VERSION;

	private lastEventId = 0;
	private streamAbort: AbortController | null = null;
	private streamOpen = false;
	private streamReconnects = 0;
	private closed = false;

	private notificationHandlers = new Set<WmpNotificationHandler>();
	private requestHandler: WmpRequestHandler | null = null;
	private streamLostHandlers = new Set<(error: Error) => void>();

	constructor(rpcUrl: string, getToken: () => string, options: WmpClientOptions = {}) {
		this.rpcUrl = rpcUrl.replace(/\/+$/, '');
		this.eventsUrl = options.eventsUrl ?? `${this.rpcUrl}/events`;
		this.ttlSeconds = options.ttlSeconds;
		this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		this.getToken = getToken;
	}

	// ===== State =====

	hasSession(): boolean {
		return this.sessionId !== null && !this.closed;
	}

	isStreaming(): boolean {
		return this.streamOpen;
	}

	capabilities(): WmpCapabilities {
		return this.negotiated;
	}

	hasCapability(name: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.negotiated, name);
	}

	/** The `wmp` metadata member every message carries. */
	meta(): { version: string; session_id?: string } {
		return this.sessionId ? { version: this.version, session_id: this.sessionId } : { version: this.version };
	}

	setTokenProvider(getToken: () => string): void {
		this.getToken = getToken;
	}

	onNotification(handler: WmpNotificationHandler): () => void {
		this.notificationHandlers.add(handler);
		return () => this.notificationHandlers.delete(handler);
	}

	setRequestHandler(handler: WmpRequestHandler | null): void {
		this.requestHandler = handler;
	}

	/** Called when the stream is lost for good (reconnects and resume failed). */
	onStreamLost(handler: (error: Error) => void): () => void {
		this.streamLostHandlers.add(handler);
		return () => this.streamLostHandlers.delete(handler);
	}

	// ===== Session =====

	/**
	 * Create a session (Core 4.1) and open its event stream. Resolves once the
	 * stream is connected: completion members that are secrets (OpenID4x
	 * 3.1.4.2) are only delivered live, so no flow may start before that.
	 */
	async open(capabilitiesOffered: WmpCapabilities): Promise<void> {
		this.closed = false;
		const params: Record<string, unknown> = {
			wmp: { version: this.version },
			capabilities_offered: capabilitiesOffered,
			security: { mode: 'tls' },
		};
		if (this.ttlSeconds) params.ttl = this.ttlSeconds;

		const result = await this.call('wmp.session.create', params) as {
			wmp?: { version?: string; session_id?: string };
			capabilities?: WmpCapabilities;
			resumption_token?: string;
		};
		if (!result?.wmp?.session_id) {
			throw new WmpRpcError(0, 'wmp.session.create returned no session_id');
		}
		this.sessionId = result.wmp.session_id;
		this.version = result.wmp.version || this.version;
		this.negotiated = result.capabilities ?? {};
		this.resumptionToken = result.resumption_token ?? null;
		this.lastEventId = 0;
		logger.debug('[WMP] session created', {
			capabilities: Object.keys(this.negotiated),
			resumable: !!this.resumptionToken,
		});
		await this.startStream();
	}

	/** Resume the session (Core 4.5); the token is single-use and rotated. */
	async resume(): Promise<boolean> {
		if (!this.sessionId || !this.resumptionToken) return false;
		try {
			const result = await this.call('wmp.session.resume', {
				wmp: { version: this.version },
				session_id: this.sessionId,
				resumption_token: this.resumptionToken,
				...(this.lastEventId ? { last_received_id: String(this.lastEventId) } : {}),
			}) as { resumed?: boolean; resumption_token?: string; capabilities?: WmpCapabilities };
			this.resumptionToken = result?.resumption_token ?? null;
			if (result?.capabilities) this.negotiated = result.capabilities;
			logger.debug('[WMP] session resumed', { resumed: result?.resumed });
			return result?.resumed !== false;
		} catch (e) {
			logger.warn('[WMP] session resume failed', e);
			return false;
		}
	}

	/** Close the session (best effort) and stop the stream. */
	async close(): Promise<void> {
		const hadSession = this.hasSession();
		this.closed = true;
		this.stopStream();
		if (hadSession) {
			try {
				await this.call('wmp.session.close', { wmp: this.meta(), reason: 'normal' });
			} catch {
				// The session expires on its own.
			}
		}
		this.sessionId = null;
		this.resumptionToken = null;
		this.negotiated = {};
	}

	// ===== JSON-RPC =====

	async call(method: string, params: Record<string, unknown>): Promise<unknown> {
		const body = await this.post({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
		if (body?.error) {
			throw new WmpRpcError(body.error.code, body.error.message, body.error.data);
		}
		return body?.result;
	}

	async notify(method: string, params: Record<string, unknown>): Promise<void> {
		await this.post({ jsonrpc: '2.0', method, params });
	}

	private async respond(id: string | number, result: unknown): Promise<void> {
		await this.post({ jsonrpc: '2.0', id, result });
	}

	private async respondError(id: string | number, code: number, message: string): Promise<void> {
		await this.post({ jsonrpc: '2.0', id, error: { code, message } });
	}

	private async post(message: WmpMessage): Promise<WmpMessage | null> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.getToken()}`,
		};
		if (this.sessionId) headers['Wmp-Session-Id'] = this.sessionId;

		const res = await this.fetchImpl(this.rpcUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(message),
		});
		const text = await res.text();
		if (!res.ok) {
			// A JSON-RPC error may come with an HTTP error status.
			try {
				const parsed = JSON.parse(text) as WmpMessage;
				if (parsed?.error) return parsed;
			} catch {
				// not JSON
			}
			throw new WmpRpcError(0, `WMP HTTP ${res.status}`);
		}
		if (!text.trim()) return null;
		return JSON.parse(text) as WmpMessage;
	}

	// ===== Event stream =====

	private startStream(): Promise<void> {
		this.stopStream();
		const abort = new AbortController();
		this.streamAbort = abort;

		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const settle = (err?: Error) => {
				if (settled) return;
				settled = true;
				if (err) reject(err); else resolve();
			};
			this.readStream(abort, () => settle())
				.then(() => {
					settle(new Error('WMP event stream ended before it opened'));
					this.onStreamEnded(abort, null);
				})
				.catch((err: Error) => {
					settle(err);
					this.onStreamEnded(abort, err);
				});
		});
	}

	private stopStream(): void {
		this.streamAbort?.abort();
		this.streamAbort = null;
		this.streamOpen = false;
	}

	private async readStream(abort: AbortController, onOpen: () => void): Promise<void> {
		const headers: Record<string, string> = {
			Accept: 'text/event-stream',
			Authorization: `Bearer ${this.getToken()}`,
		};
		if (this.sessionId) headers['Wmp-Session-Id'] = this.sessionId;
		if (this.lastEventId) headers['Last-Event-ID'] = String(this.lastEventId);

		const res = await this.fetchImpl(this.eventsUrl, { method: 'GET', headers, signal: abort.signal });
		if (res.status === 410) {
			throw new WmpRpcError(410, 'WMP event replay gap');
		}
		if (!res.ok || !res.body) {
			throw new WmpRpcError(res.status, `WMP event stream HTTP ${res.status}`);
		}

		this.streamOpen = true;
		this.streamReconnects = 0;
		onOpen();

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let eventId: string | null = null;
		let data: string[] = [];

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				let line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.endsWith('\r')) line = line.slice(0, -1);

				if (line === '') {
					if (data.length) this.dispatchEvent(eventId, data.join('\n'));
					eventId = null;
					data = [];
				} else if (line.startsWith(':')) {
					// comment / heartbeat
				} else if (line.startsWith('id:')) {
					eventId = line.slice(3).trim();
				} else if (line.startsWith('data:')) {
					data.push(line.slice(5).replace(/^ /, ''));
				}
				// "event:" and "retry:" carry nothing this client needs.
			}
		}
	}

	private async onStreamEnded(abort: AbortController, err: Error | null): Promise<void> {
		if (this.streamAbort !== abort) return; // superseded by a newer stream
		this.streamOpen = false;
		if (this.closed || abort.signal.aborted) return;

		if (err instanceof WmpRpcError && (err.code === 401 || err.code === 403)) {
			this.emitStreamLost(new Error('WMP event stream not authorized'));
			return;
		}

		if (err instanceof WmpRpcError && err.code === 404) {
			// The engine no longer knows this session (closed, expired, or it
			// restarted): forget it, so the next flow creates a new one.
			this.sessionId = null;
			this.resumptionToken = null;
			this.emitStreamLost(new Error('WMP session not found'));
			return;
		}

		if (err instanceof WmpRpcError && err.code === 410) {
			// The cursor is older than the replay window: resume, then reopen.
			if (await this.resume()) {
				this.lastEventId = 0;
				this.scheduleReconnect(0);
			} else {
				this.emitStreamLost(new Error('WMP session could not be resumed'));
			}
			return;
		}

		if (this.streamReconnects >= MAX_STREAM_RECONNECTS) {
			this.emitStreamLost(err ?? new Error('WMP event stream closed'));
			return;
		}
		const delay = STREAM_RECONNECT_BASE_MS * Math.pow(2, this.streamReconnects);
		this.streamReconnects++;
		this.scheduleReconnect(delay);
	}

	private scheduleReconnect(delayMs: number): void {
		setTimeout(() => {
			if (this.closed) return;
			this.startStream().catch((e) => logger.debug('[WMP] stream reconnect failed', e));
		}, delayMs);
	}

	private emitStreamLost(error: Error): void {
		logger.warn('[WMP] event stream lost', error.message);
		Array.from(this.streamLostHandlers).forEach((h) => {
			try { h(error); } catch (e) { logger.error('[WMP] stream-lost handler failed', e); }
		});
	}

	private dispatchEvent(eventId: string | null, raw: string): void {
		if (eventId) {
			const n = Number(eventId);
			if (Number.isFinite(n)) {
				if (n <= this.lastEventId) return; // replayed: already handled
				this.lastEventId = n;
			}
		}

		let msg: WmpMessage;
		try {
			msg = JSON.parse(raw) as WmpMessage;
		} catch {
			logger.warn('[WMP] dropped an unparseable event');
			return;
		}
		if (!msg.method) return;
		const params = (msg.params ?? {}) as Record<string, unknown>;

		if (msg.id !== undefined && msg.id !== null) {
			this.handleServerRequest(msg.id, msg.method, params);
			return;
		}
		Array.from(this.notificationHandlers).forEach((h) => {
			try { h(msg.method!, params); } catch (e) { logger.error('[WMP] notification handler failed', e); }
		});
	}

	private async handleServerRequest(id: string | number, method: string, params: Record<string, unknown>): Promise<void> {
		if (!this.requestHandler) {
			await this.respondError(id, -32601, 'Method not found').catch(() => {});
			return;
		}
		try {
			const result = await this.requestHandler(method, params);
			await this.respond(id, result);
		} catch (e) {
			const code = e instanceof WmpRpcError && e.code ? e.code : -32603;
			await this.respondError(id, code, e instanceof Error ? e.message : 'Internal error').catch(() => {});
		}
	}
}