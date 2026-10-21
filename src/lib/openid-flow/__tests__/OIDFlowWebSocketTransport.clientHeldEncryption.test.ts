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
	});

	it('sends no JWK when the engine asked for none', async () => {
		const { transport, ws, signResponses } = await setup();
		transport.onSignRequest(async () => ({ proofs: [{ proof_type: 'jwt', jwt: 'proof.jwt' }] }));

		const response = await generateProof(ws, signResponses, 'f1', 'm1', null);

		expect(response).not.toHaveProperty('credential_response_encryption_jwk');
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

	it('answers only transaction_id and interval, never the credential or the seed', async () => {
		const { ws, signResponses, jwk } = await issuance();
		const jwe = await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', {
			transaction_id: 'tx-1',
			interval: 5,
			credentials: [ISSUED],
			notification_id: 'n-1',
			credential_metadata: { 'org.siros.secret_seed': { ns: SEED } },
		});

		const response = await decrypt(ws, signResponses, 'm2', jwe);

		expect(response.transaction_id).toBe('tx-1');
		expect(response.interval).toBe(5);
		const wire = JSON.stringify(response);
		expect(wire).not.toContain(ISSUED);
		expect(wire).not.toContain(SEED);
		expect(wire).not.toContain('n-1');
		expect(response).not.toHaveProperty('error');
	});

	it('answers an error that carries no contents when decryption fails', async () => {
		const { ws, signResponses } = await issuance();
		const other = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
		const wrongKey = await issuerEncrypt(
			{ ...(await exportJWK(other.publicKey)), alg: 'ECDH-ES+A256KW' },
			'ECDH-ES+A256KW',
			'A128GCM',
			{ credentials: [ISSUED] },
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
			await issuerEncrypt(jwk, 'ECDH-ES+A256KW', 'A128GCM', { credentials: [ISSUED] }),
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
				credentials: [{ credential: 'first' }, 'second'],
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
			{ credentials: ['only-one'] },
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
			{ credentials: ['x'] },
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
		expect(protectedHeader).toMatchObject({ alg: 'ECDH-ES', enc: 'A128GCM', kid: 'v-1', cty: 'JWT' });
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
			credentials: [ISSUED],
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
			credentials: [ISSUED],
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
