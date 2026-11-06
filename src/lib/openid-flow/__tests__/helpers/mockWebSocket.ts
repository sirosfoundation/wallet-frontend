/**
 * A WebSocket stand-in for the transport tests: it opens on the next tick, records what the wallet
 * sends, and lets a test deliver engine messages.
 */
export class MockWebSocket {
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

	constructor(url: string | URL = '') {
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

/** Every socket the code under test opened since the last install, in order. */
export const sockets: MockWebSocket[] = [];

/** Replace the global WebSocket with the mock and forget earlier sockets; returns the restore function. */
export function installMockWebSocket(): () => void {
	sockets.length = 0;
	const original = globalThis.WebSocket;
	// @ts-expect-error - mocking WebSocket
	globalThis.WebSocket = class extends MockWebSocket {
		constructor(url: string | URL) {
			super(url);
			sockets.push(this);
		}
	};
	return () => {
		globalThis.WebSocket = original;
	};
}
