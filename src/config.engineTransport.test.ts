import { describe, it, expect } from 'vitest';
import { pickEngineTransport } from './config';

const endpoints = { wmpUrl: 'https://be/api/v2/wallet/rpc', wsUrl: 'wss://be/api/v2/wallet' };

describe('pickEngineTransport', () => {
	it('keeps the WebSocket engine when nothing else is configured (the default)', () => {
		expect(pickEngineTransport(['websocket', 'direct'], ['websocket'], endpoints)).toBe('websocket');
	});

	it('takes the first allowed engine in the preference order', () => {
		const all = ['core_local', 'core_remote', 'websocket'] as const;
		expect(pickEngineTransport([...all], [...all], endpoints)).toBe('core_local');
		expect(pickEngineTransport(['core_remote', 'core_local', 'websocket'], [...all], endpoints)).toBe('core_remote');
	});

	it('skips an engine that is preferred but not allowed: both cores are opt-in', () => {
		expect(pickEngineTransport(['core_local', 'core_remote', 'websocket'], ['websocket'], endpoints)).toBe('websocket');
		expect(pickEngineTransport(['core_local', 'core_remote', 'websocket'], ['core_remote', 'websocket'], endpoints)).toBe('core_remote');
	});

	it('skips an engine whose endpoint is not configured', () => {
		expect(pickEngineTransport(['core_remote', 'websocket'], ['core_remote', 'websocket'], { wsUrl: endpoints.wsUrl })).toBe('websocket');
		expect(pickEngineTransport(['websocket'], ['websocket'], {})).toBeNull();
	});

	it('needs no WebSocket URL for the wallet core on the backend', () => {
		expect(pickEngineTransport(['core_remote'], ['core_remote'], { wmpUrl: endpoints.wmpUrl })).toBe('core_remote');
	});

	it('ignores transports that are not engines', () => {
		expect(pickEngineTransport(['direct'], ['direct'], endpoints)).toBeNull();
	});
});
