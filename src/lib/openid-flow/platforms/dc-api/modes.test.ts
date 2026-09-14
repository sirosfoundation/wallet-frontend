import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DCAPIWalletCompanionMode } from './modes';
import type { DCAPIEnvelope } from './resources';

function makeEnvelope(requestId = 'test-request-123'): DCAPIEnvelope {
	return { requestId, selectedCredentialIDs: [] };
}

describe('DCAPIWalletCompanionMode', () => {
	let mode: DCAPIWalletCompanionMode;
	let mockOpener: {
		postMessage: ReturnType<typeof vi.fn>
	};
	let mockClose: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mode = new DCAPIWalletCompanionMode();
		mockOpener = { postMessage: vi.fn() };
		mockClose = vi.fn();

		vi.stubGlobal('opener', mockOpener);
		vi.stubGlobal('close', mockClose);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	describe('originHandshake()', () => {
		it('posts WC_ORIGIN_CHECK message to opener', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope());

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					// In a real browser environment, the origin and source would be set by the browser based on the sender of the message.
					// It would not be possible for the sender to set arbitrary values.
					origin: 'https://verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);

			await handshakePromise;

			expect(mockOpener.postMessage).toHaveBeenCalledWith(
				{ type: 'WC_ORIGIN_CHECK', requestId: 'test-request-123' },
				'*'
			);
		});

		it('resolves with origin on valid WC_ORIGIN_ACK', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope());

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					source: mockOpener as unknown as Window,
					origin: 'https://verifier.example.com',
				}));
			}, 10);

			const origin = await handshakePromise;

			expect(origin).toBe('https://verifier.example.com');
		});

		it('rejects on timeout (5s)', async () => {
			vi.useFakeTimers();

			const handshakePromise = mode.originHandshake(makeEnvelope());

			vi.advanceTimersByTime(5000);

			await expect(handshakePromise).rejects.toThrow('Origin handshake timeout');
		});

		it('rejects when origin not in expected_origins', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope(), [
				'https://trusted-verifier.example.com',
			]);

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					origin: 'https://untrusted-verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);

			await expect(handshakePromise).rejects.toThrow(
				'Origin https://untrusted-verifier.example.com not in expected_origins'
			);
		});

		it('accepts any origin when expected_origins is undefined', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope());

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					origin: 'https://any-verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);

			const origin = await handshakePromise;

			expect(origin).toBe('https://any-verifier.example.com');
		});

		it('rejects on mismatched requestId from opener', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope());

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'wrong-request-id' },
					origin: 'https://verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);

			await expect(handshakePromise).rejects.toThrow(
				'Mismatched requestId in origin handshake response.'
			);
		});

		it('ignores messages with wrong type', async () => {
			vi.useFakeTimers();

			const handshakePromise = mode.originHandshake(makeEnvelope());

			// Send message with wrong type - should be ignored
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'WRONG_TYPE', requestId: 'test-request-123' },
				origin: 'https://verifier.example.com',
				source: mockOpener as unknown as Window,
			}));

			vi.advanceTimersByTime(100);

			// Send correct message
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
				origin: 'https://verifier.example.com',
				source: mockOpener as unknown as Window,
			}));

			const origin = await handshakePromise;
			expect(origin).toBe('https://verifier.example.com');
		});

		it('ignores messages not from opener', async () => {
			vi.useFakeTimers();

			const handshakePromise = mode.originHandshake(makeEnvelope());

			// Send message from different source (not opener) - should be ignored
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
				origin: 'https://verifier.example.com',
				source: null, // Not from opener
			}));

			vi.advanceTimersByTime(100);

			// Send correct message from opener
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
				origin: 'https://verifier.example.com',
				source: mockOpener as unknown as Window,
			}));

			const origin = await handshakePromise;
			expect(origin).toBe('https://verifier.example.com');
		});
	});

	describe('verifiedOrigin getter', () => {
		it('returns origin after successful handshake', async () => {
			const handshakePromise = mode.originHandshake(makeEnvelope());

			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					origin: 'https://verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);

			await handshakePromise;

			expect(mode.verifiedOrigin).toBe('https://verifier.example.com');
		});

		it('throws before handshake completed', () => {
			expect(() => mode.verifiedOrigin).toThrow('Origin not verified');
		});
	});

	describe('send()', () => {
		beforeEach(async () => {
			// Complete handshake first
			const handshakePromise = mode.originHandshake(makeEnvelope());
			setTimeout(() => {
				window.dispatchEvent(new MessageEvent('message', {
					data: { type: 'WC_ORIGIN_ACK', requestId: 'test-request-123' },
					origin: 'https://verifier.example.com',
					source: mockOpener as unknown as Window,
				}));
			}, 10);
			await handshakePromise;
		});

		it('throws when no window.opener', () => {
			vi.stubGlobal('opener', null);

			expect(() => mode.send({
				requestId: 'test-request-123',
				payload: { vp_token: {} },
			})).toThrow('No opener window');
		});

		it('throws when origin not verified', () => {
			const freshMode = new DCAPIWalletCompanionMode();

			expect(() => freshMode.send({
				requestId: 'test-request-123',
				payload: { vp_token: {} },
			})).toThrow('Origin not verified');
		});

		it('posts WC_WALLET_RESPONSE with vp_token', () => {
			const vpToken = { credential: ['token1', 'token2'] };

			mode.send({
				requestId: 'test-request-123',
				payload: { vp_token: vpToken },
			});

			expect(mockOpener.postMessage).toHaveBeenCalledWith(
				{
					type: 'WC_WALLET_RESPONSE',
					requestId: 'test-request-123',
					response: { vp_token: vpToken },
				},
				'https://verifier.example.com'
			);
		});

		it('posts WC_WALLET_RESPONSE with encrypted response', () => {
			const encryptedResponse = 'eyJhbGciOiJFQ0RILUVT...encrypted...';

			mode.send({
				requestId: 'test-request-123',
				payload: { response: encryptedResponse },
			});

			expect(mockOpener.postMessage).toHaveBeenCalledWith(
				{
					type: 'WC_WALLET_RESPONSE',
					requestId: 'test-request-123',
					response: encryptedResponse,
				},
				'https://verifier.example.com'
			);
		});

		it('posts WC_WALLET_RESPONSE with error field', () => {
			mode.send({
				requestId: 'test-request-123',
				payload: { error: 'user_cancelled' },
			});

			expect(mockOpener.postMessage).toHaveBeenCalledWith(
				{
					type: 'WC_WALLET_RESPONSE',
					requestId: 'test-request-123',
					error: 'user_cancelled',
				},
				'https://verifier.example.com'
			);
		});

		it('posts to verified origin only', () => {
			mode.send({
				requestId: 'test-request-123',
				payload: { vp_token: {} },
			});

			expect(mockOpener.postMessage).toHaveBeenCalledWith(
				expect.any(Object),
				'https://verifier.example.com'
			);
		});
	});

	describe('close()', () => {
		it('calls window.close()', () => {
			mode.close();

			expect(mockClose).toHaveBeenCalled();
		});
	});
});
