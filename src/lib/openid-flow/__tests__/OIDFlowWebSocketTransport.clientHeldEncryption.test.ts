/**
 * OIDFlowWebSocketTransport: client-held response encryption on the wire.
 *
 * The engine sends ciphertext and asks the wallet to decrypt (issuance) or to
 * build the JARM response (presentation). These tests drive the transport with
 * engine-shaped messages and inspect exactly what the wallet sends back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK } from 'jose';
import type { JWK } from 'jose';
import { OIDFlowWebSocketTransport } from '../transports/OIDFlowWebSocketTransport';
import type { SignHandlerRequest, SignRequestHandler } from '../transports/OIDFlowWebSocketTransport';
import type { OIDFlowSignRequest, OIDFlowSignResponse } from '@/hooks/useOIDFlowSignHandler';
import { OIDFlowTransportWithRetry } from '../decorators/OIDFlowTransportWithRetry';
import { verifierJwkThumbprint } from '../encryption';
import type { IOIDFlowTransport } from '../types/IOIDFlowTransport';

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState: number = MockWebSocket.CONNECTING;
	url: string;
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	sentMessages: string[] = [];

	constructor(url: string | URL) {
		this.url = typeof url === 'string' ? url : url.toString();
		setTimeout(() => {
			this.readyState = MockWebSocket.OPEN;
			this.onopen?.(new Event('open'));
		}, 0);
	}

	send(data: string): void {
		this.sentMessages.push(data);
	}

	close(code?: number, reason?: string): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.({ code: code ?? 1000, reason: reason ?? '' } as CloseEvent);
	}

	simulateMessage(data: unknown): void {
		this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
	}
}

let sockets: MockWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
	sockets = [];
	// @ts-expect-error - mocking WebSocket
	globalThis.WebSocket = class extends MockWebSocket {
		constructor(url: string | URL) {
			super(url);
			sockets.push(this);
		}
	};
});

afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
	vi.restoreAllMocks();
});

const ISSUED = 'eyJhbGciOiJFUzI1NiJ9.issued.credential~disclosure~';
const SEED = 'cd'.repeat(16);

async function issuerEncrypt(jwk: JWK, alg: string, enc: string, body: unknown): Promise<string> {
	return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(body)))
		.setProtectedHeader({ alg, enc })
		.encrypt(await importJWK(jwk, alg));
}

async function setup() {
	const transport = new OIDFlowWebSocketTransport('wss://test.example.com/api/v2/wallet', 'token');
	await transport.connect();
	const ws = sockets[0];
	const signResponses = () =>
		ws.sentMessages.map((m) => JSON.parse(m)).filter((m) => m.type === 'sign_response');
	return { transport, ws, signResponses };
}

/** Send generate_proof with response encryption and return the wallet's public JWK. */
async function generateProof(
	ws: MockWebSocket,
	signResponses: () => Array<Record<string, unknown>>,
	flowId: string,
	messageId: string,
	encryption: Record<string, unknown> | null = { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' },
	proofTypes: Record<string, unknown> | null = { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
) {
	ws.simulateMessage({
		type: 'sign_request',
		flow_id: flowId,
		message_id: messageId,
		action: 'generate_proof',
		params: {
			audience: 'https://issuer.example.com',
			nonce: 'n',
			proof_type: 'jwt',
			...(proofTypes ? { proof_types_supported: proofTypes } : {}),
			...(encryption ? { credential_response_encryption: encryption } : {}),
		},
	});
	await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === messageId)).toBe(true));
	return signResponses().find((r) => r.message_id === messageId)!;
}

describe('generate_proof with credential_response_encryption', () => {
	it('returns the public response-encryption JWK next to the proofs', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));

		const response = await generateProof(ws, signResponses, 'f1', 'm1');

		expect(response.proofs).toEqual([{ proof_type: 'jwt', jwt: 'proof.jwt' }]);
		expect(response.credential_response_encryption_jwk).toMatchObject({
			kty: 'EC',
			crv: 'P-256',
			use: 'enc',
			alg: 'ECDH-ES+A256KW',
		});
		expect(response.credential_response_encryption_jwk).not.toHaveProperty('d');
		expect(Object.keys(response.credential_response_encryption_jwk as object).sort()).toEqual(
			['alg', 'crv', 'kty', 'use', 'x', 'y'],
		);
	});

	it('sends no JWK when the engine asked for none', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));

		const response = await generateProof(ws, signResponses, 'f1', 'm1', null);

		expect(response).not.toHaveProperty('credential_response_encryption_jwk');
	});

	it('is key-only without proof types: the JWK, no proofs, and no sign handler involved', async () => {
		const { transport, ws, signResponses } = await setup();
		const handler = vi.fn().mockResolvedValue({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] });
		transport.onSignRequest(handler);

		for (const proofTypes of [null, {}]) {
			const response = await generateProof(ws, signResponses, 'f1', `m-${proofTypes === null ? 'none' : 'empty'}`, undefined, proofTypes);

			expect(response.credential_response_encryption_jwk).toMatchObject({ kty: 'EC', use: 'enc' });
			expect(response).not.toHaveProperty('proofs');
			expect(response).not.toHaveProperty('error');
		}
		expect(handler).not.toHaveBeenCalled();
	});

	it('answers an error, with no proofs, when encryption is required and not possible', async () => {
		const { transport, ws, signResponses } = await setup();
		const handler = vi.fn().mockResolvedValue({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] });
		transport.onSignRequest(handler);

		const response = await generateProof(ws, signResponses, 'f1', 'm1', {
			alg: 'RSA-OAEP',
			enc: 'A256GCM',
			required: true,
		});

		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('proofs');
		expect(response).not.toHaveProperty('credential_response_encryption_jwk');
	});

	it('a failing older request does not remove the key a newer request generated meanwhile', async () => {
		const { transport, ws, signResponses } = await setup();
		let failOlder!: (reason: Error) => void;
		transport.onSignRequest((request) =>
			request.messageId === 'm-older'
				? new Promise((_resolve, reject) => {
						failOlder = reject;
					})
				: Promise.resolve({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }),
		);
		const proofTypes = { jwt: { proof_signing_alg_values_supported: ['ES256'] } };
		const encryption = { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' };
		const send = (messageId: string) =>
			ws.simulateMessage({
				type: 'sign_request',
				flow_id: 'f1',
				message_id: messageId,
				action: 'generate_proof',
				params: {
					audience: 'https://issuer.example.com',
					proof_types_supported: proofTypes,
					credential_response_encryption: encryption,
				},
			});

		send('m-older');
		await vi.waitFor(() => expect(failOlder).toBeTypeOf('function'));
		send('m-newer');
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-newer')).toBe(true));
		const newer = signResponses().find((r) => r.message_id === 'm-newer')!;

		failOlder(new Error('no wscd'));
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-older')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm-older')!.error).toBe('no wscd');

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm-decrypt',
			action: 'decrypt_credential_response',
			params: {
				jwe: await issuerEncrypt(
					newer.credential_response_encryption_jwk as JWK,
					'ECDH-ES+A256KW',
					'A128GCM',
					{ credentials: [{ credential: ISSUED }] },
				),
				deferred: false,
			},
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-decrypt')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm-decrypt')!.credential_count).toBe(1);
	});

	it('does not advertise a superseded key when an older request’s handler succeeds after a newer request replaced it', async () => {
		const { transport, ws, signResponses } = await setup();
		let succeedOlder!: (value: { proofs: Array<{ proof_type: 'jwt'; jwt: string }> }) => void;
		transport.onSignRequest((request) =>
			request.messageId === 'm-older'
				? new Promise((resolve) => {
						succeedOlder = resolve;
					})
				: Promise.resolve({ proofs: [{ proof_type: 'jwt', jwt: 'newer.proof' }] }),
		);
		const send = (messageId: string) =>
			ws.simulateMessage({
				type: 'sign_request',
				flow_id: 'f1',
				message_id: messageId,
				action: 'generate_proof',
				params: {
					audience: 'https://issuer.example.com',
					proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
					credential_response_encryption: { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' },
				},
			});

		send('m-older');
		await vi.waitFor(() => expect(succeedOlder).toBeTypeOf('function'));
		send('m-newer');
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-newer')).toBe(true));
		const newer = signResponses().find((r) => r.message_id === 'm-newer')!;

		succeedOlder({ proofs: [{ proof_type: 'jwt', jwt: 'older.proof' }] });
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-older')).toBe(true));
		const older = signResponses().find((r) => r.message_id === 'm-older')!;

		expect(older.error).toBe('The response encryption key was superseded by a newer request');
		expect(older).not.toHaveProperty('credential_response_encryption_jwk');
		expect(older).not.toHaveProperty('proofs');
		expect(JSON.stringify(older)).not.toContain('older.proof');

		// The newer request's key is untouched and still decrypts.
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm-decrypt',
			action: 'decrypt_credential_response',
			params: {
				jwe: await issuerEncrypt(
					newer.credential_response_encryption_jwk as JWK,
					'ECDH-ES+A256KW',
					'A128GCM',
					{ credentials: [{ credential: ISSUED }] },
				),
				deferred: false,
			},
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-decrypt')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm-decrypt')!.credential_count).toBe(1);
	});

	it('drops the new key when the sign handlers fail', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => {
			throw new Error('no wscd');
		});

		const response = await generateProof(ws, signResponses, 'f1', 'm1');
		expect(response.error).toBe('no wscd');
		expect(response).not.toHaveProperty('credential_response_encryption_jwk');

		// A decrypt for that flow now has no key to use.
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe: 'a.b.c.d.e' },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm2')!.error).toBe(
			'No response encryption key for this flow',
		);
	});
});

describe('decrypt_credential_response', () => {
	async function issuance() {
		const ctx = await setup();
		ctx.transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const proof = await generateProof(ctx.ws, ctx.signResponses, 'f1', 'm1');
		const jwk = proof.credential_response_encryption_jwk as JWK;
		return { ...ctx, jwk };
	}

	async function decrypt(
		ws: MockWebSocket,
		signResponses: () => Array<Record<string, unknown>>,
		messageId: string,
		jwe: string,
		deferred = false,
	) {
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: messageId,
			action: 'decrypt_credential_response',
			params: { jwe, deferred },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === messageId)).toBe(true));
		return signResponses().find((r) => r.message_id === messageId)!;
	}

	it('answers only credential_count, never the credential, the notification_id or the seed', async () => {
		const { ws, signResponses, jwk } = await issuance();
		const jwe = await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', {
			credentials: [{ credential: ISSUED }, { credential: 'second' }],
			notification_id: 'n-1',
			credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
		});

		const response = await decrypt(ws, signResponses, 'm2', jwe);

		expect(response.credential_count).toBe(2);
		expect(response).not.toHaveProperty('transaction_id');
		expect(response).not.toHaveProperty('interval');
		expect(response).not.toHaveProperty('error');
		const wire = JSON.stringify(response);
		expect(wire).not.toContain(ISSUED);
		expect(wire).not.toContain(SEED);
		expect(wire).not.toContain('n-1');
	});

	it('answers only transaction_id and interval for a deferred answer, and again on every poll', async () => {
		const { ws, signResponses, jwk } = await issuance();
		const pending = (interval: number) => issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { transaction_id: 'tx-1', interval });

		const first = await decrypt(ws, signResponses, 'm2', await pending(5));
		const second = await decrypt(ws, signResponses, 'm3', await pending(10), true);
		const done = await decrypt(
			ws, signResponses, 'm4',
			await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { credentials: [{ credential: ISSUED }] }),
			true,
		);

		expect([first.transaction_id, first.interval]).toEqual(['tx-1', 5]);
		expect([second.transaction_id, second.interval]).toEqual(['tx-1', 10]);
		expect(first).not.toHaveProperty('credential_count');
		expect(done.credential_count).toBe(1);
		expect(done).not.toHaveProperty('transaction_id');
	});

	it('reads the deferred flag: a seed is refused on a deferred answer and accepted on the immediate one', async () => {
		const { ws, signResponses, jwk } = await issuance();
		const withSeed = () =>
			issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', {
				credentials: [{ credential: ISSUED }],
				credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
			});

		const deferredAnswer = await decrypt(ws, signResponses, 'm2', await withSeed(), true);
		const immediateAnswer = await decrypt(ws, signResponses, 'm3', await withSeed(), false);

		expect(deferredAnswer.error).toBeTruthy();
		expect(deferredAnswer).not.toHaveProperty('credential_count');
		expect(JSON.stringify(deferredAnswer)).not.toContain(SEED);
		expect(immediateAnswer.credential_count).toBe(1);
	});

	it('answers an error for a response that is both, or neither', async () => {
		const { ws, signResponses, jwk } = await issuance();

		const both = await decrypt(
			ws, signResponses, 'm2',
			await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { transaction_id: 'tx-1', credentials: [{ credential: ISSUED }] }),
		);
		const neither = await decrypt(
			ws, signResponses, 'm3', await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', {}),
		);

		for (const r of [both, neither]) {
			expect(r.error).toBeTruthy();
			expect(r).not.toHaveProperty('credential_count');
			expect(r).not.toHaveProperty('transaction_id');
		}
	});

	it('answers an error when the issuer used another alg/enc than the one negotiated', async () => {
		const { ws, signResponses, jwk } = await issuance();

		const response = await decrypt(
			ws, signResponses, 'm2',
			await issuerEncrypt({ ...jwk, alg: 'ECDH-ES' }, 'ECDH-ES', 'A128GCM', { credentials: [{ credential: ISSUED }] }),
		);

		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('credential_count');
	});

	it('answers an error that carries no contents when decryption fails', async () => {
		const { ws, signResponses } = await issuance();
		const other = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const wrongKey = await issuerEncrypt(
			{ ...(await exportJWK(other.publicKey)), alg: 'ECDH-ES+A256KW' },
			'ECDH-ES+A256KW',
			'A128GCM',
			{ credentials: [{ credential: ISSUED }] },
		);

		const response = await decrypt(ws, signResponses, 'm2', wrongKey);

		expect(response.error).toBeTruthy();
		expect(JSON.stringify(response)).not.toContain(ISSUED);
		expect(JSON.stringify(response)).not.toContain(wrongKey);
	});

	it('answers an error for a missing jwe', async () => {
		const { ws, signResponses } = await issuance();

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: {},
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));

		expect(signResponses().find((r) => r.message_id === 'm2')!.error).toBe('Missing jwe');
	});

	it('never reaches the sign handlers', async () => {
		const { transport, ws, signResponses, jwk } = await issuance();
		const handler = vi.fn().mockResolvedValue({});
		transport.onSignRequest(handler);
		handler.mockClear();

		await decrypt(
			ws,
			signResponses,
			'm2',
			await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { credentials: [{ credential: ISSUED }] }),
		);

		expect(handler).not.toHaveBeenCalled();
	});
});

describe('flow_complete of an encrypted issuance', () => {
	async function completedIssuance(
		engineCredentials: Array<Record<string, unknown>>,
		issuerBody: unknown,
		complete: Record<string, unknown> = { credential_response_encrypted: true },
	) {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));

		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		const proof = await generateProof(ws, signResponses, flowId, 'm1');
		const jwe = await issuerEncrypt(
			proof.credential_response_encryption_jwk as JWK,
			'ECDH-ES+A256KW',
			'A128GCM',
			issuerBody,
		);
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: engineCredentials,
			...complete,
		});
		return { flowPromise, ws, signResponses, flowId };
	}

	it('fills each engine entry from the decrypted credentials, in order', async () => {
		const { flowPromise } = await completedIssuance(
			[
				{ format: 'dc+sd-jwt', vct: 'urn:a' },
				{ format: 'dc+sd-jwt', vct: 'urn:b' },
			],
			{
				credentials: [{ credential: 'first' }, { credential: 'second' }],
				notification_id: 'n-1',
				credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
			},
		);

		const result = await flowPromise;

		expect(result.success).toBe(true);
		expect(result.credentials).toEqual([
			{ format: 'dc+sd-jwt', vct: 'urn:a', credential: 'first', notification_id: 'n-1' },
			{ format: 'dc+sd-jwt', vct: 'urn:b', credential: 'second', notification_id: 'n-1' },
		]);
		expect(result.credentialMetadata).toEqual({ 'org.siros.secret_seed': { ns: SEED } });
	});

	it('is an error when the entry count does not match the decrypted credentials', async () => {
		const { flowPromise } = await completedIssuance(
			[{ format: 'dc+sd-jwt' }, { format: 'dc+sd-jwt' }],
			{ credentials: [{ credential: 'only-one' }] },
		);

		const result = await flowPromise;

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CREDENTIAL_DECRYPTION_FAILED');
		expect(result.credentials).toBeUndefined();
	});

	it('is an error when nothing was decrypted for the flow', async () => {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt' }],
			credential_response_encrypted: true,
		});

		const result = await flowPromise;
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CREDENTIAL_DECRYPTION_FAILED');
	});

	it('leaves a plain completion untouched', async () => {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt', credential: 'plain.credential' }],
		});

		const result = await flowPromise;
		expect(result.success).toBe(true);
		expect(result.credentials).toEqual([{ format: 'dc+sd-jwt', credential: 'plain.credential' }]);
	});

	it('forgets the key once the flow has completed', async () => {
		const { ws, signResponses, flowId, flowPromise } = await completedIssuance(
			[{ format: 'dc+sd-jwt' }],
			{ credentials: [{ credential: 'x' }] },
		);
		await flowPromise;

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm3',
			action: 'decrypt_credential_response',
			params: { jwe: 'a.b.c.d.e' },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm3')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm3')!.error).toBe(
			'No response encryption key for this flow',
		);
	});

	it('forgets the key when the socket closes', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		await generateProof(ws, signResponses, 'f1', 'm1');

		await transport.disconnect();
		await transport.connect();
		const ws2 = sockets[1];
		const responses2 = () => ws2.sentMessages.map((m) => JSON.parse(m)).filter((m) => m.type === 'sign_response');
		ws2.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe: 'a.b.c.d.e' },
		});
		await vi.waitFor(() => expect(responses2().length).toBe(1));
		expect(responses2()[0].error).toBe('No response encryption key for this flow');
	});
});

describe('sign_presentation with response_encryption (direct_post.jwt)', () => {
	async function verifierKey() {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		return { jwk: { ...(await exportJWK(publicKey)), kid: 'v-1', use: 'enc', alg: 'ECDH-ES' }, privateKey };
	}

	async function present(extraParams: Record<string, unknown>, handlerResult: Record<string, unknown>) {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => handlerResult);
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm1',
			action: 'sign_presentation',
			params: { audience: 'legacy-audience', nonce: 'n', ...extraParams },
		});
		await vi.waitFor(() => expect(signResponses().length).toBe(1));
		return signResponses()[0];
	}

	it('returns only response_jwe, built for the verified client_id, and no vp_token', async () => {
		const { jwk, privateKey } = await verifierKey();
		const vpToken = JSON.stringify({ pid: ['sd-jwt~kb'] });

		const response = await present(
			{
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
				state: 'st-1',
				verified_request: {
					client_id: 'x509_san_dns:verifier.example.com',
					response_uri: 'https://verifier.example.com/post',
					response_mode: 'direct_post.jwt',
				},
			},
			{ vpToken },
		);

		expect(response).not.toHaveProperty('vp_token');
		expect(response).not.toHaveProperty('error');
		expect(JSON.stringify(response)).not.toContain('sd-jwt~kb');
		const { plaintext, protectedHeader } = await compactDecrypt(response.response_jwe as string, privateKey);
		expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES', enc: 'A128GCM', kid: 'v-1' });
		expect(protectedHeader).not.toHaveProperty('cty');
		const claims = JSON.parse(new TextDecoder().decode(plaintext));
		expect(claims).toMatchObject({
			iss: 'https://self-issued.me/v2',
			aud: 'x509_san_dns:verifier.example.com',
			vp_token: { pid: ['sd-jwt~kb'] },
			state: 'st-1',
		});
		expect(claims.exp - claims.iat).toBe(300);
	});

	it('takes aud from verified_request, never from audience', async () => {
		const { jwk, privateKey } = await verifierKey();

		const response = await present(
			{
				audience: 'attacker-controlled-audience',
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
				verified_request: { client_id: 'verified-client' },
			},
			{ vpToken: '{}' },
		);

		const { plaintext } = await compactDecrypt(response.response_jwe as string, privateKey);
		expect(JSON.parse(new TextDecoder().decode(plaintext)).aud).toBe('verified-client');
	});

	it('fails closed with an error, and no response_jwe, when verified_request has no client_id', async () => {
		const { jwk } = await verifierKey();

		const response = await present(
			{ response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' } },
			{ vpToken: '{}' },
		);

		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('response_jwe');
		expect(response).not.toHaveProperty('vp_token');
	});

	it('answers a failing sign handler with an error and no response_jwe', async () => {
		const { jwk } = await verifierKey();
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => {
			throw new Error('user declined');
		});

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm1',
			action: 'sign_presentation',
			params: {
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
				verified_request: { client_id: 'verified-client' },
			},
		});
		await vi.waitFor(() => expect(signResponses().length).toBe(1));

		expect(signResponses()[0].error).toBe('user declined');
		expect(signResponses()[0]).not.toHaveProperty('response_jwe');
	});

	it('sets the protected header to exactly the requested alg/enc and the JWK kid', async () => {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(publicKey)), kid: 'wrapped-1', alg: 'ECDH-ES+A256KW' };

		const response = await present(
			{
				response_encryption: { jwk, alg: 'ECDH-ES+A256KW', enc: 'A256GCM' },
				verified_request: { client_id: 'verified-client' },
			},
			{ vpToken: '{}' },
		);

		const jwe = response.response_jwe as string;
		expect(jwe.split('.')).toHaveLength(5);
		expect(jwe.split('.').every((seg) => seg.length > 0)).toBe(true);
		const { protectedHeader } = await compactDecrypt(jwe, privateKey);
		expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES+A256KW', enc: 'A256GCM', kid: 'wrapped-1' });
		expect(protectedHeader).not.toHaveProperty('cty');
	});

	it('refuses a private verifier JWK: an error and no response_jwe', async () => {
		const { privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(privateKey)), kid: 'v-1' };

		const response = await present(
			{
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
				verified_request: { client_id: 'verified-client' },
			},
			{ vpToken: '{}' },
		);

		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('response_jwe');
		expect(response).not.toHaveProperty('vp_token');
	});

	it('refuses a direct_post.jwt request without encryption parameters: an error, never a plaintext vp_token', async () => {
		const handler = vi.fn().mockResolvedValue({ vpToken: '{"pid":["secret.presentation"]}' });
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(handler);

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm1',
			action: 'sign_presentation',
			params: {
				audience: 'verifier',
				nonce: 'n',
				verified_request: { client_id: 'verified-client', response_mode: 'direct_post.jwt' },
			},
		});
		await vi.waitFor(() => expect(signResponses().length).toBe(1));

		const response = signResponses()[0];
		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('vp_token');
		expect(response).not.toHaveProperty('response_jwe');
		expect(JSON.stringify(response)).not.toContain('secret.presentation');
		expect(handler).not.toHaveBeenCalled();
	});

	it('still returns the vp_token in clear for a plain direct_post request', async () => {
		const response = await present(
			{ verified_request: { client_id: 'verified-client', response_mode: 'direct_post' } },
			{ vpToken: '{"pid":["t"]}' },
		);

		expect(response.vp_token).toBe('{"pid":["t"]}');
		expect(response).not.toHaveProperty('error');
	});

	it('encrypts to a verifier key whose kid is non-ASCII', async () => {
		const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const jwk = { ...(await exportJWK(publicKey)), kid: 'clé-1', alg: 'ECDH-ES' };

		const response = await present(
			{
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
				verified_request: { client_id: 'verified-client', response_mode: 'direct_post.jwt' },
			},
			{ vpToken: '{}' },
		);

		expect(response).not.toHaveProperty('error');
		const { protectedHeader } = await compactDecrypt(response.response_jwe as string, privateKey);
		expect(protectedHeader.kid).toBe('clé-1');
	});

	it('leaves other response modes alone: vp_token is returned as before', async () => {
		const response = await present({ audience: 'verifier' }, { vpToken: '{"pid":["t"]}' });

		expect(response.vp_token).toBe('{"pid":["t"]}');
		expect(response).not.toHaveProperty('response_jwe');
	});
});

describe('response-level credential_metadata in flow_complete', () => {
	async function complete(frame: Record<string, unknown>) {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		ws.simulateMessage({ type: 'flow_complete', flow_id: flowId, ...frame });
		return flowPromise;
	}

	const plainCredentials = [{ format: 'dc+sd-jwt', credential: 'plain.credential' }];

	it('accepts only display and claims from a plain frame, and drops every extension member', async () => {
		const result = await complete({
			credentials: plainCredentials,
			credential_metadata: {
				display: [{ name: 'PID' }],
				claims: [{ path: ['a'] }],
				'org.siros.secret_seed': { ns: SEED },
				DISPLAY: [{ name: 'wrong case' }],
				other: 1,
			},
		});

		expect(result.success).toBe(true);
		expect(result.credentialMetadata).toEqual({ display: [{ name: 'PID' }], claims: [{ path: ['a'] }] });
		expect(JSON.stringify(result)).not.toContain(SEED);
	});

	it('gives a plain frame with only extension members no metadata at all', async () => {
		const result = await complete({
			credentials: plainCredentials,
			credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
		});

		expect(result.credentialMetadata).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain(SEED);
	});

	it.each([['a string', 'display'], ['an array', ['display']], ['a number', 7], ['null', null]])(
		'ignores a credential_metadata that is %s',
		async (_label, bad) => {
			const result = await complete({ credentials: plainCredentials, credential_metadata: bad });

			expect(result.success).toBe(true);
			expect(result.credentialMetadata).toBeUndefined();
		},
	);

	it('uses only the locally decrypted object for an encrypted response, ignoring the frame', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		const proof = await generateProof(ws, signResponses, flowId, 'm1');
		const jwe = await issuerEncrypt(proof.credential_response_encryption_jwk as JWK, 'ECDH-ES+A256KW', 'A128GCM', {
			credentials: [{ credential: ISSUED }],
			credential_metadata: { 'org.siros.secret_seed': { ns: SEED }, display: [{ name: 'decrypted' }] },
		});
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt' }],
			credential_response_encrypted: true,
			credential_metadata: { display: [{ name: 'frame' }], 'org.siros.secret_seed': { ns: 'ef'.repeat(16) } },
		});

		const result = await flowPromise;
		expect(result.credentialMetadata).toEqual({
			'org.siros.secret_seed': { ns: SEED },
			display: [{ name: 'decrypted' }],
		});
		expect(JSON.stringify(result)).not.toContain('ef'.repeat(16));
	});

	it('uses no metadata for an encrypted response whose decrypted body had none, ignoring the frame', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		const proof = await generateProof(ws, signResponses, flowId, 'm1');
		const jwe = await issuerEncrypt(proof.credential_response_encryption_jwk as JWK, 'ECDH-ES+A256KW', 'A128GCM', {
			credentials: [{ credential: ISSUED }],
		});
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt' }],
			credential_response_encrypted: true,
			credential_metadata: { display: [{ name: 'frame' }] },
		});

		const result = await flowPromise;
		expect(result.success).toBe(true);
		expect(result.credentialMetadata).toBeUndefined();
	});
});

describe('credential_metadata from every message that resolves an issuance flow', () => {
	it('filters a progress message too: a seed in an authorization_required frame never reaches the result', async () => {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		ws.simulateMessage({
			type: 'progress',
			flow_id: flowId,
			step: 'authorization_required',
			payload: { authorization_url: 'https://issuer.example.com/authorize' },
			credential_metadata: {
				display: [{ name: 'PID' }],
				'org.siros.secret_seed': { ns: SEED },
			},
		});

		const result = await flowPromise;
		expect(result.authorizationUrl).toBe('https://issuer.example.com/authorize');
		expect(result.credentialMetadata).toEqual({ display: [{ name: 'PID' }] });
		expect(JSON.stringify(result)).not.toContain(SEED);
	});

	it('does not let a frame member impersonate the decrypted side channel', async () => {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt', credential: 'plain.credential' }],
			credentialMetadata: { 'org.siros.secret_seed': { ns: SEED } },
			decrypted: { credentialMetadata: { 'org.siros.secret_seed': { ns: SEED } } },
		});

		const result = await flowPromise;
		expect(result.credentialMetadata).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain(SEED);
	});
});

describe('a plain flow_complete after response encryption was offered', () => {
	it('is an error, not silently accepted plaintext', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		await generateProof(ws, signResponses, flowId, 'm1');

		ws.simulateMessage({
			type: 'flow_complete',
			flow_id: flowId,
			credentials: [{ format: 'dc+sd-jwt', credential: 'plain.credential' }],
			credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
		});

		const result = await flowPromise;
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CREDENTIAL_RESPONSE_NOT_ENCRYPTED');
		expect(result.credentials).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain('plain.credential');
		expect(JSON.stringify(result)).not.toContain(SEED);
	});

	it('drops the offered key even though the completion was refused', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		await generateProof(ws, signResponses, flowId, 'm1');
		ws.simulateMessage({ type: 'flow_complete', flow_id: flowId, credentials: [{ format: 'dc+sd-jwt', credential: 'c' }] });
		await flowPromise;

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe: 'a.b.c.d.e' },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm2')!.error).toBe('No response encryption key for this flow');
	});
});

describe('releaseFlow (the wallet aborted or cancelled the flow locally)', () => {
	async function flowWithKey() {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const flowPromise = transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		flowPromise.catch(() => undefined);
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;
		const proof = await generateProof(ws, signResponses, flowId, 'm1');
		return { transport, ws, signResponses, flowId, jwk: proof.credential_response_encryption_jwk as JWK };
	}

	it('drops the key and decrypted response of the flow in progress', async () => {
		const { transport, ws, signResponses, flowId, jwk } = await flowWithKey();

		transport.releaseFlow();

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: {
				jwe: await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { credentials: [{ credential: ISSUED }] }),
				deferred: false,
			},
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));
		const answer = signResponses().find((r) => r.message_id === 'm2')!;
		expect(answer.error).toBe('The flow was released locally');
		expect(answer).not.toHaveProperty('credential_count');
	});

	it('does nothing when no flow is in progress', async () => {
		const { transport } = await setup();

		expect(() => transport.releaseFlow()).not.toThrow();
	});

	it('is forwarded by the retry decorator to the transport it wraps', () => {
		const inner = { releaseFlow: vi.fn() } as unknown as IOIDFlowTransport;

		new OIDFlowTransportWithRetry(inner).releaseFlow();

		expect(inner.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('is a no-op through the decorator when the wrapped transport keeps nothing per flow', () => {
		const inner = {} as unknown as IOIDFlowTransport;

		expect(() => new OIDFlowTransportWithRetry(inner).releaseFlow()).not.toThrow();
	});
});

describe('a flow the wallet released locally stays released', () => {
	const RELEASED = 'The flow was released locally';

	async function startedFlow(
		handler = vi.fn().mockResolvedValue({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }),
	) {
		const ctx = await setup();
		ctx.transport.onSignRequest(handler);
		const flowPromise = ctx.transport.startOID4VCIFlow({ credentialOfferUri: 'openid-credential-offer://?x' });
		flowPromise.catch(() => undefined);
		await vi.waitFor(() => expect(ctx.ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ctx.ws.sentMessages[1]).flow_id as string;
		return { ...ctx, handler, flowId, flowPromise };
	}

	it('refuses a generate_proof that arrives after the release: no key, no handler, no proofs', async () => {
		const { transport, ws, signResponses, handler, flowId } = await startedFlow();

		transport.releaseFlow();
		const response = await generateProof(ws, signResponses, flowId, 'm-late');

		expect(response.error).toBe(RELEASED);
		expect(response).not.toHaveProperty('credential_response_encryption_jwk');
		expect(response).not.toHaveProperty('proofs');
		expect(handler).not.toHaveBeenCalled();
	});

	it('refuses a sign_presentation and a sign_client_auth for it too, without invoking a handler', async () => {
		const { transport, ws, signResponses, handler, flowId } = await startedFlow();
		transport.releaseFlow();

		for (const [id, action] of [['m1', 'sign_presentation'], ['m2', 'sign_client_auth']]) {
			ws.simulateMessage({ type: 'sign_request', flow_id: flowId, message_id: id, action, params: { audience: 'a', nonce: 'n' } });
			await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === id)).toBe(true));
			expect(signResponses().find((r) => r.message_id === id)!.error).toBe(RELEASED);
		}
		expect(handler).not.toHaveBeenCalled();
	});

	it('answers an error, not success, for an operation still pending when the flow is released', async () => {
		let finish!: (value: { proofs: Array<{ proof_type: 'jwt'; jwt: string }> }) => void;
		const { transport, ws, signResponses, flowId } = await startedFlow(
			vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			),
		);
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm-pending',
			action: 'generate_proof',
			params: {
				audience: 'https://issuer.example.com',
				proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
				credential_response_encryption: { alg: 'ECDH-ES+A256KW', enc: 'A128GCM' },
			},
		});
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));

		transport.releaseFlow();
		finish({ proofs: [{ proof_type: 'jwt', jwt: 'late.proof' }] });

		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-pending')).toBe(true));
		const answer = signResponses().find((r) => r.message_id === 'm-pending')!;
		expect(answer.error).toBe(RELEASED);
		expect(answer).not.toHaveProperty('proofs');
		expect(answer).not.toHaveProperty('credential_response_encryption_jwk');
		expect(JSON.stringify(answer)).not.toContain('late.proof');
	});

	it('answers an error for a decryption still pending when the flow is released', async () => {
		const { transport, ws, signResponses, flowId } = await startedFlow();
		const proof = await generateProof(ws, signResponses, flowId, 'm1');
		const jwe = await issuerEncrypt(
			proof.credential_response_encryption_jwk as JWK,
			'ECDH-ES+A256KW',
			'A128GCM',
			{ credentials: [{ credential: ISSUED }] },
		);

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: flowId,
			message_id: 'm-decrypt',
			action: 'decrypt_credential_response',
			params: { jwe, deferred: false },
		});
		transport.releaseFlow();

		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm-decrypt')).toBe(true));
		const answer = signResponses().find((r) => r.message_id === 'm-decrypt')!;
		expect(answer.error).toBe(RELEASED);
		expect(answer).not.toHaveProperty('credential_count');
	});

	it('leaves every other flow alone', async () => {
		const { transport, ws, signResponses, flowId } = await startedFlow();
		transport.releaseFlow();

		const other = await generateProof(ws, signResponses, `${flowId}-other`, 'm-other');

		expect(other).not.toHaveProperty('error');
		expect(other.credential_response_encryption_jwk).toMatchObject({ kty: 'EC', use: 'enc' });
	});

	it('forgets the release once the engine has ended the flow', async () => {
		const { transport, ws, signResponses, flowId, flowPromise } = await startedFlow();
		transport.releaseFlow();
		ws.simulateMessage({ type: 'flow_error', flow_id: flowId, error: { code: 'X', message: 'ended' } });
		await flowPromise.catch(() => undefined);

		const again = await generateProof(ws, signResponses, flowId, 'm-again');

		expect(again).not.toHaveProperty('error');
	});

	it('forgets the release when the socket closes', async () => {
		const { transport, flowId } = await startedFlow();
		transport.releaseFlow();

		await transport.disconnect();
		await transport.connect();
		const ws2 = sockets[1];
		const responses2 = () => ws2.sentMessages.map((m) => JSON.parse(m)).filter((m) => m.type === 'sign_response');
		const again = await generateProof(ws2, responses2, flowId, 'm-again');

		expect(again).not.toHaveProperty('error');
	});

	it('remembers at most 64 released flows, the oldest forgotten first', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const internals = transport as unknown as { currentFlowId: string | null };
		for (let i = 0; i < 65; i++) {
			internals.currentFlowId = `flow-${i}`;
			transport.releaseFlow();
		}

		const oldest = await generateProof(ws, signResponses, 'flow-0', 'm-oldest');
		const newest = await generateProof(ws, signResponses, 'flow-64', 'm-newest');

		expect(oldest).not.toHaveProperty('error');
		expect(newest.error).toBe(RELEASED);
	});
});

describe('a flow started after a release is a new flow', () => {
	async function startFlow(ctx: Awaited<ReturnType<typeof setup>>, offer: string) {
		const before = ctx.ws.sentMessages.length;
		const promise = ctx.transport.startOID4VCIFlow({ credentialOfferUri: offer });
		promise.catch(() => undefined);
		await vi.waitFor(() => expect(ctx.ws.sentMessages.length).toBeGreaterThan(before));
		return { promise, flowId: JSON.parse(ctx.ws.sentMessages[before]).flow_id as string };
	}

	it('gets a fresh flow id and signs normally, while the released flow stays refused', async () => {
		const ctx = await setup();
		const handler = vi.fn().mockResolvedValue({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] });
		ctx.transport.onSignRequest(handler);
		const first = await startFlow(ctx, 'openid-credential-offer://?first');

		ctx.transport.releaseFlow();
		const second = await startFlow(ctx, 'openid-credential-offer://?second');

		expect(second.flowId).not.toBe(first.flowId);
		const signed = await generateProof(ctx.ws, ctx.signResponses, second.flowId, 'm-second');
		expect(signed).not.toHaveProperty('error');
		expect(signed.proofs).toEqual([{ proof_type: 'jwt', jwt: 'proof.jwt' }]);
		const late = await generateProof(ctx.ws, ctx.signResponses, first.flowId, 'm-first-late');
		expect(late.error).toBe('The flow was released locally');
	});

	it('settles the released flow’s pending request with an error', async () => {
		const ctx = await setup();
		const first = await startFlow(ctx, 'openid-credential-offer://?first');

		ctx.transport.releaseFlow();

		await expect(first.promise).rejects.toThrow('The flow was released locally');
	});

	it('leaves the pending requests of every other flow alone', async () => {
		const ctx = await setup();
		const first = await startFlow(ctx, 'openid-credential-offer://?first');
		const unrelated = { resolve: vi.fn(), reject: vi.fn(), flowId: 'unrelated-flow', timeout: setTimeout(() => undefined, 60_000) };
		const internals = ctx.transport as unknown as { pending: Map<string, typeof unrelated> };
		internals.pending.set('unrelated-flow', unrelated);

		ctx.transport.releaseFlow();

		await expect(first.promise).rejects.toThrow('The flow was released locally');
		expect(unrelated.reject).not.toHaveBeenCalled();
		expect(internals.pending.has('unrelated-flow')).toBe(true);
		clearTimeout(unrelated.timeout);
	});

	it('is not touched by a late terminal frame of the released flow', async () => {
		const ctx = await setup();
		ctx.transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));
		const first = await startFlow(ctx, 'openid-credential-offer://?first');
		ctx.transport.releaseFlow();
		const second = await startFlow(ctx, 'openid-credential-offer://?second');
		const proof = await generateProof(ctx.ws, ctx.signResponses, second.flowId, 'm-second');

		ctx.ws.simulateMessage({ type: 'flow_error', flow_id: first.flowId, error: { code: 'X', message: 'late' } });

		ctx.ws.simulateMessage({
			type: 'sign_request',
			flow_id: second.flowId,
			message_id: 'm-decrypt',
			action: 'decrypt_credential_response',
			params: {
				jwe: await issuerEncrypt(
					proof.credential_response_encryption_jwk as JWK,
					'ECDH-ES+A256KW',
					'A128GCM',
					{ credentials: [{ credential: ISSUED }] },
				),
				deferred: false,
			},
		});
		await vi.waitFor(() => expect(ctx.signResponses().some((r) => r.message_id === 'm-decrypt')).toBe(true));
		expect(ctx.signResponses().find((r) => r.message_id === 'm-decrypt')!.credential_count).toBe(1);
		// And the second flow is still the active one: a further release reaches it.
		ctx.transport.releaseFlow();
		const afterRelease = await generateProof(ctx.ws, ctx.signResponses, second.flowId, 'm-after');
		expect(afterRelease.error).toBe('The flow was released locally');
	});
});

describe('a refused request does not keep the key it generated', () => {
	it('drops the key when no sign handler is registered', async () => {
		const { ws, signResponses } = await setup();

		const refused = await generateProof(ws, signResponses, 'f1', 'm1');
		expect(refused.error).toBe('No sign handler available');
		expect(refused).not.toHaveProperty('credential_response_encryption_jwk');

		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm2',
			action: 'decrypt_credential_response',
			params: { jwe: 'a.b.c.d.e', deferred: false },
		});
		await vi.waitFor(() => expect(signResponses().some((r) => r.message_id === 'm2')).toBe(true));
		expect(signResponses().find((r) => r.message_id === 'm2')!.error).toBe('No response encryption key for this flow');
	});
});

describe('verified_request on a sign_presentation request', () => {
	async function presentWith(params: Record<string, unknown>) {
		const { transport, ws, signResponses } = await setup();
		const handler = vi.fn().mockResolvedValue({ vpToken: '{"pid":["t"]}' });
		transport.onSignRequest(handler);
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm1',
			action: 'sign_presentation',
			params: { audience: 'verifier', nonce: 'n', ...params },
		});
		await vi.waitFor(() => expect(signResponses().length).toBe(1));
		return { handler, response: signResponses()[0] };
	}

	it('maps the whole verified_request object', async () => {
		const clientMetadata = { vp_formats_supported: { 'dc+sd-jwt': {} }, jwks: { keys: [] } };

		const { handler } = await presentWith({
			verified_request: {
				client_id: 'x509_san_dns:verifier.example.com',
				client_id_scheme: 'x509_san_dns',
				response_mode: 'direct_post',
				response_uri: 'https://verifier.example.com/post',
				signed: true,
				signature_verification: 'verified',
				client_metadata: clientMetadata,
				unknown_member: 'ignored',
			},
		});

		expect(handler.mock.calls[0][0].params.verifiedRequest).toEqual({
			clientId: 'x509_san_dns:verifier.example.com',
			clientIdScheme: 'x509_san_dns',
			responseMode: 'direct_post',
			responseUri: 'https://verifier.example.com/post',
			signed: true,
			signatureVerification: 'verified',
			clientMetadata,
		});
	});

	it('reads a request without the optional members as not signed, with no verification verdict', async () => {
		const { handler } = await presentWith({
			verified_request: { client_id: 'c', signed: 'yes', signature_verification: 'maybe', client_metadata: ['x'] },
		});

		expect(handler.mock.calls[0][0].params.verifiedRequest).toEqual({
			clientId: 'c',
			clientIdScheme: undefined,
			responseMode: undefined,
			responseUri: undefined,
			signed: false,
			signatureVerification: undefined,
			clientMetadata: undefined,
		});
	});

	it('carries the validated request on the OID4VP result of the credential selection too', async () => {
		const { transport, ws } = await setup();
		const flowPromise = transport.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' });
		await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

		ws.simulateMessage({
			type: 'progress',
			flow_id: flowId,
			step: 'credential_selection',
			payload: {
				dcql_query: { credentials: [] },
				verified_request: {
					client_id: 'c',
					client_id_scheme: 'redirect_uri',
					signature_verification: 'none',
					client_metadata: { vp_formats_supported: {} },
				},
			},
		});

		const result = await flowPromise;
		expect(result.verifiedRequest).toMatchObject({
			clientId: 'c',
			clientIdScheme: 'redirect_uri',
			signed: false,
			signatureVerification: 'none',
			clientMetadata: { vp_formats_supported: {} },
		});
	});
});

describe('the mdoc verifier JWK thumbprint for direct_post.jwt', () => {
	async function verifierKey() {
		const { publicKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		return { ...(await exportJWK(publicKey)), kid: 'v-1', use: 'enc', alg: 'ECDH-ES' };
	}

	async function present(params: Record<string, unknown>) {
		const { transport, ws, signResponses } = await setup();
		const handler = vi.fn().mockResolvedValue({ vpToken: '{}' });
		transport.onSignRequest(handler);
		ws.simulateMessage({
			type: 'sign_request',
			flow_id: 'f1',
			message_id: 'm1',
			action: 'sign_presentation',
			params: { audience: 'verifier', nonce: 'n', ...params },
		});
		await vi.waitFor(() => expect(signResponses().length).toBe(1));
		return { handler, response: signResponses()[0] };
	}

	it('is computed from response_encryption.jwk, not taken from the engine', async () => {
		const jwk = await verifierKey();

		const { handler, response } = await present({
			verifier_jwk_thumbprint: 'engine-supplied-thumbprint',
			response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
			verified_request: { client_id: 'verified-client', response_mode: 'direct_post.jwt' },
		});

		expect(response).not.toHaveProperty('error');
		const seen = handler.mock.calls[0][0].params.verifierJwkThumbprint;
		expect(seen).toBe(await verifierJwkThumbprint(jwk));
		expect(seen).not.toBe('engine-supplied-thumbprint');
	});

	it('answers an error when the response_encryption key cannot be thumbprinted', async () => {
		const { handler, response } = await present({
			response_encryption: { jwk: { kty: 'EC' }, alg: 'ECDH-ES', enc: 'A128GCM' },
			verified_request: { client_id: 'verified-client', response_mode: 'direct_post.jwt' },
		});

		expect(response.error).toBeTruthy();
		expect(response).not.toHaveProperty('response_jwe');
		expect(handler).not.toHaveBeenCalled();
	});

	it('leaves the engine value alone when the request is not direct_post.jwt', async () => {
		const { handler } = await present({
			verifier_jwk_thumbprint: 'engine-supplied-thumbprint',
			verified_request: { client_id: 'c', response_mode: 'direct_post' },
		});

		expect(handler.mock.calls[0][0].params.verifierJwkThumbprint).toBe('engine-supplied-thumbprint');
	});
});

// Compile-time checks (`tsc --noEmit`): the sign-handler hook's callback can be registered with
// the transport, and a registered handler is never handed the transport-only decrypt action.
const hookHandlerIsRegistrable: SignRequestHandler = (_request: OIDFlowSignRequest): Promise<OIDFlowSignResponse> =>
	Promise.resolve({});
const handlerActionExcludesDecrypt: SignHandlerRequest['action'] = 'sign_presentation';
// @ts-expect-error the decrypt action is the transport's own and never reaches a sign handler
const decryptIsNotAHandlerAction: SignHandlerRequest['action'] = 'decrypt_credential_response';
void [hookHandlerIsRegistrable, handlerActionExcludesDecrypt, decryptIsNotAHandlerAction];

describe('the wallet policy for a zkp_req presentation', () => {
	const zkpQuery = { credentials: [{ id: 'zkp', format: 'zkp_req' }] };
	const sdJwtQuery = { credentials: [{ id: 'pid', format: 'dc+sd-jwt' }] };
	const signedJwt = {
		client_id: 'x509_san_dns:verifier.example.com',
		client_id_scheme: 'x509_san_dns',
		response_mode: 'direct_post.jwt',
		response_uri: 'https://verifier.example.com/post',
		signed: true,
		signature_verification: 'verified',
	};
	const unsigned = { ...signedJwt, client_id_scheme: 'redirect_uri', signed: false, signature_verification: 'none' };
	const signedPlain = { ...signedJwt, response_mode: 'direct_post' };

	async function verifierKey() {
		const { publicKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		return { ...(await exportJWK(publicKey)), kid: 'v-1', use: 'enc', alg: 'ECDH-ES' };
	}

	/** Start an OID4VP flow and deliver its credential_selection progress message. */
	async function selection(dcql: unknown, verifiedRequest: unknown) {
		const ctx = await setup();
		const flowPromise = ctx.transport.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' });
		await vi.waitFor(() => expect(ctx.ws.sentMessages.length).toBeGreaterThan(1));
		const flowId = JSON.parse(ctx.ws.sentMessages[1]).flow_id as string;
		ctx.ws.simulateMessage({
			type: 'progress',
			flow_id: flowId,
			step: 'credential_selection',
			payload: { dcql_query: dcql, verified_request: verifiedRequest },
		});
		const result = await flowPromise;
		const sent = () => ctx.ws.sentMessages.map((m) => JSON.parse(m));
		return { ...ctx, flowId, result, sent, declines: () => sent().filter((m) => m.type === 'flow_action' && m.action === 'decline') };
	}

	describe('at the credential selection', () => {
		it('refuses an unsigned zkp_req request and tells the engine to decline', async () => {
			const { result, declines, flowId } = await selection(zkpQuery, unsigned);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('ZKP_REQ_REFUSED');
			expect(result.error?.message).toMatch(/signed request object/);
			expect(result.dcqlQuery).toBeUndefined();
			expect(declines()).toEqual([expect.objectContaining({ flow_id: flowId, action: 'decline' })]);
		});

		it('refuses a signed zkp_req request over a response that is not encrypted', async () => {
			const { result, declines } = await selection(zkpQuery, signedPlain);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('ZKP_REQ_REFUSED');
			expect(result.error?.message).toMatch(/encrypted/);
			expect(declines()).toHaveLength(1);
		});

		it('refuses a zkp_req request with no verified_request at all (fails closed)', async () => {
			const { result, declines } = await selection(zkpQuery, undefined);

			expect(result.error?.code).toBe('ZKP_REQ_REFUSED');
			expect(declines()).toHaveLength(1);
		});

		it('accepts a signed zkp_req request with an encrypted response mode', async () => {
			const { result, declines } = await selection(zkpQuery, signedJwt);

			expect(result.success).toBe(true);
			expect(result.dcqlQuery).toEqual(zkpQuery);
			expect(result.verifiedRequest).toMatchObject({ signed: true, responseMode: 'direct_post.jwt' });
			expect(declines()).toHaveLength(0);
		});

		it.each([
			['unsigned, plain direct_post', { ...unsigned, response_mode: 'direct_post' }],
			['no verified_request', undefined],
		])('leaves a non-zkp request alone (%s)', async (_label, verifiedRequest) => {
			const { result, declines } = await selection(sdJwtQuery, verifiedRequest);

			expect(result.success).toBe(true);
			expect(result.dcqlQuery).toEqual(sdJwtQuery);
			expect(declines()).toHaveLength(0);
		});

		it('is not triggered by a verifier that only advertises zkp_req support', async () => {
			const { result, declines } = await selection(sdJwtQuery, {
				...unsigned,
				client_metadata: { vp_formats_supported: { zkp_req: { proof_system_values: ['vega'] } } },
			});

			expect(result.success).toBe(true);
			expect(declines()).toHaveLength(0);
		});

		it('also refuses when the request reaches the result through another message (fail-safe in the mapper)', async () => {
			const { transport, ws } = await setup();
			const flowPromise = transport.startOID4VPFlow({ requestUriRef: 'https://v.example/r', clientId: 'c' });
			await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(1));
			const flowId = JSON.parse(ws.sentMessages[1]).flow_id as string;

			ws.simulateMessage({ type: 'flow_complete', flow_id: flowId, payload: { dcql_query: zkpQuery, verified_request: unsigned } });

			const result = await flowPromise;
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('ZKP_REQ_REFUSED');
			expect(result.dcqlQuery).toBeUndefined();
		});
	});

	describe('at a match request', () => {
		async function match(dcql: unknown, verifiedRequest: unknown) {
			const ctx = await setup();
			const handler = vi.fn().mockResolvedValue({ matches: [] });
			ctx.transport.onMatchRequest(handler);
			ctx.ws.simulateMessage({
				type: 'match_request',
				flow_id: 'f1',
				message_id: 'mm1',
				dcql_query: dcql,
				verified_request: verifiedRequest,
			});
			await vi.waitFor(() => expect(ctx.ws.sentMessages.some((m) => JSON.parse(m).type === 'match_response')).toBe(true));
			const response = ctx.ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'match_response');
			return { ...ctx, handler, response };
		}

		it('answers an error, without matching anything, for an unsigned zkp_req request', async () => {
			const { handler, response } = await match(zkpQuery, unsigned);

			expect(response.error).toMatch(/signed request object/);
			expect(response).not.toHaveProperty('matches');
			expect(handler).not.toHaveBeenCalled();
		});

		it('answers an error for a signed zkp_req request over a response that is not encrypted', async () => {
			const { handler, response } = await match(zkpQuery, signedPlain);

			expect(response.error).toMatch(/encrypted/);
			expect(handler).not.toHaveBeenCalled();
		});

		it('matches a signed zkp_req request with an encrypted response mode', async () => {
			const { handler, response } = await match(zkpQuery, signedJwt);

			expect(response).not.toHaveProperty('error');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('matches a non-zkp request however it is delivered', async () => {
			const { handler, response } = await match(sdJwtQuery, unsigned);

			expect(response).not.toHaveProperty('error');
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('at the sign request of a zkp_req flow', () => {
		async function signAfter(dcql: unknown, selectionRequest: unknown, signParams: Record<string, unknown>) {
			const ctx = await setup();
			const handler = vi.fn().mockResolvedValue({ vpToken: '{"zkp":["proof"]}' });
			ctx.transport.onSignRequest(handler);
			ctx.transport.onMatchRequest(vi.fn().mockResolvedValue({ matches: [] }));
			ctx.ws.simulateMessage({
				type: 'match_request',
				flow_id: 'f1',
				message_id: 'mm1',
				dcql_query: dcql,
				verified_request: selectionRequest,
			});
			await vi.waitFor(() => expect(ctx.ws.sentMessages.some((m) => JSON.parse(m).type === 'match_response')).toBe(true));
			ctx.ws.simulateMessage({
				type: 'sign_request',
				flow_id: 'f1',
				message_id: 'ms1',
				action: 'sign_presentation',
				params: { audience: 'verifier', nonce: 'n', ...signParams },
			});
			await vi.waitFor(() => expect(ctx.signResponses().length).toBe(1));
			return { ...ctx, handler, response: ctx.signResponses()[0] };
		}

		it('refuses with SIGN_REFUSED, signing nothing, when the sign request carries no response_encryption', async () => {
			const { handler, response } = await signAfter(zkpQuery, signedJwt, { verified_request: signedJwt });

			expect(response.error_code).toBe('SIGN_REFUSED');
			expect(response.error).toMatch(/encrypted/);
			expect(response).not.toHaveProperty('vp_token');
			expect(response).not.toHaveProperty('response_jwe');
			expect(handler).not.toHaveBeenCalled();
		});

		it('refuses with SIGN_REFUSED when the sign request itself shows an unsigned request', async () => {
			const jwk = await verifierKey();

			const { handler, response } = await signAfter(zkpQuery, signedJwt, {
				verified_request: unsigned,
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
			});

			expect(response.error_code).toBe('SIGN_REFUSED');
			expect(response.error).toMatch(/signed request object/);
			expect(handler).not.toHaveBeenCalled();
		});

		it('signs a signed zkp_req request with an encrypted response', async () => {
			const jwk = await verifierKey();

			const { handler, response } = await signAfter(zkpQuery, signedJwt, {
				verified_request: signedJwt,
				response_encryption: { jwk, alg: 'ECDH-ES', enc: 'A128GCM' },
			});

			expect(response).not.toHaveProperty('error');
			expect(response).not.toHaveProperty('error_code');
			expect(response.response_jwe).toEqual(expect.any(String));
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('leaves the sign request of a non-zkp flow alone, even when it looks unsigned and plain', async () => {
			const { handler, response } = await signAfter(sdJwtQuery, unsigned, { verified_request: { ...unsigned, response_mode: 'direct_post' } });

			expect(response).not.toHaveProperty('error');
			expect(response.vp_token).toBe('{"zkp":["proof"]}');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('leaves a sign request for a flow the wallet never saw a zkp_req query for alone', async () => {
			const { transport, ws, signResponses } = await setup();
			const handler = vi.fn().mockResolvedValue({ vpToken: '{}' });
			transport.onSignRequest(handler);

			ws.simulateMessage({
				type: 'sign_request',
				flow_id: 'untracked',
				message_id: 'ms1',
				action: 'sign_presentation',
				params: { audience: 'v', nonce: 'n', verified_request: { ...unsigned, response_mode: 'direct_post' } },
			});
			await vi.waitFor(() => expect(signResponses().length).toBe(1));

			expect(signResponses()[0]).not.toHaveProperty('error');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('forgets the zkp_req flow when the engine ends it', async () => {
			const ctx = await setup();
			ctx.transport.onSignRequest(vi.fn().mockResolvedValue({ vpToken: '{}' }));
			ctx.transport.onMatchRequest(vi.fn().mockResolvedValue({ matches: [] }));
			ctx.ws.simulateMessage({ type: 'match_request', flow_id: 'f1', message_id: 'mm1', dcql_query: zkpQuery, verified_request: signedJwt });
			await vi.waitFor(() => expect(ctx.ws.sentMessages.some((m) => JSON.parse(m).type === 'match_response')).toBe(true));
			ctx.ws.simulateMessage({ type: 'flow_error', flow_id: 'f1', error: { code: 'X', message: 'ended' } });

			ctx.ws.simulateMessage({
				type: 'sign_request',
				flow_id: 'f1',
				message_id: 'ms-after',
				action: 'sign_presentation',
				params: { audience: 'v', nonce: 'n', verified_request: { ...unsigned, response_mode: 'direct_post' } },
			});
			await vi.waitFor(() => expect(ctx.signResponses().length).toBe(1));

			expect(ctx.signResponses()[0]).not.toHaveProperty('error');
		});
	});
});
