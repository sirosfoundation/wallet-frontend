/**
 * Tests for OID4VCI §10 credential notification across transports.
 *
 * Covers:
 * - dispatchCredentialNotifications utility function
 * - NullOIDFlowTransport.sendCredentialNotification (no-op)
 * - OIDFlowDirectTransport.sendCredentialNotification (no-op)
 * - OIDFlowHttpProxyTransport.sendCredentialNotification (no-op)
 * - OIDFlowTransportWithRetry delegate
 */

import { describe, it, expect, vi } from 'vitest';
import { OIDFlowTransportWithRetry } from '../decorators/OIDFlowTransportWithRetry';
import { NullOIDFlowTransport } from '../types/IOIDFlowTransport';
import { OIDFlowDirectTransport } from '../transports/OIDFlowDirectTransport';
import { OIDFlowHttpProxyTransport } from '../transports/OIDFlowHttpProxyTransport';
import { dispatchCredentialNotifications } from '../utils/credentialNotifications';

// ─── dispatchCredentialNotifications ──────────────────────────────────────────

describe('dispatchCredentialNotifications', () => {
	it('is a no-op when transport is null', () => {
		expect(() => {
			dispatchCredentialNotifications(null, [{ format: 'vc+sd-jwt', credential: 'eyJ...', notification_id: 'n1' }], 'flow-1');
		}).not.toThrow();
	});

	it('is a no-op when transport is undefined', () => {
		expect(() => {
			dispatchCredentialNotifications(undefined, [], 'flow-1');
		}).not.toThrow();
	});

	it('is a no-op when flowId is undefined', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(transport, [{ format: 'vc+sd-jwt', credential: 'eyJ...', notification_id: 'n1' }], undefined);
		expect(transport.sendCredentialNotification).not.toHaveBeenCalled();
	});

	it('is a no-op when flowId is empty string', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(transport, [{ format: 'vc+sd-jwt', credential: 'eyJ...', notification_id: 'n1' }], '');
		expect(transport.sendCredentialNotification).not.toHaveBeenCalled();
	});

	it('is a no-op when credentials is undefined', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(transport, undefined, 'flow-1');
		expect(transport.sendCredentialNotification).not.toHaveBeenCalled();
	});

	it('is a no-op when credentials is empty', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(transport, [], 'flow-1');
		expect(transport.sendCredentialNotification).not.toHaveBeenCalled();
	});

	it('skips credentials without notification_id', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(
			transport,
			[{ format: 'vc+sd-jwt', credential: 'eyJ...' }],
			'flow-1',
		);
		expect(transport.sendCredentialNotification).not.toHaveBeenCalled();
	});

	it('calls sendCredentialNotification for each credential with notification_id', () => {
		const transport = { sendCredentialNotification: vi.fn() } as any;
		dispatchCredentialNotifications(
			transport,
			[
				{ format: 'vc+sd-jwt', credential: 'eyJ1', notification_id: 'notif-1' },
				{ format: 'vc+sd-jwt', credential: 'eyJ2' },
				{ format: 'vc+sd-jwt', credential: 'eyJ3', notification_id: 'notif-3' },
			],
			'flow-42',
		);
		expect(transport.sendCredentialNotification).toHaveBeenCalledTimes(2);
		expect(transport.sendCredentialNotification).toHaveBeenCalledWith('flow-42', 'notif-1', 'credential_accepted');
		expect(transport.sendCredentialNotification).toHaveBeenCalledWith('flow-42', 'notif-3', 'credential_accepted');
	});
});

// ─── NullOIDFlowTransport ─────────────────────────────────────────────────────

describe('NullOIDFlowTransport.sendCredentialNotification', () => {
	it('is a no-op and does not throw', () => {
		const t = new NullOIDFlowTransport();
		expect(() => {
			t.sendCredentialNotification('f', 'n', 'credential_accepted');
		}).not.toThrow();
	});
});

// ─── OIDFlowDirectTransport ───────────────────────────────────────────────────

describe('OIDFlowDirectTransport.sendCredentialNotification', () => {
	it('is a no-op and does not throw', () => {
		const t = new OIDFlowDirectTransport();
		expect(() => {
			t.sendCredentialNotification('flow-1', 'notif-1', 'credential_accepted');
		}).not.toThrow();
	});
});

// ─── OIDFlowHttpProxyTransport ────────────────────────────────────────────────

describe('OIDFlowHttpProxyTransport.sendCredentialNotification', () => {
	it('is a no-op and does not throw', () => {
		const mockHttpClient = {
			get: vi.fn(),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		} as any;
		const t = new OIDFlowHttpProxyTransport(mockHttpClient);
		expect(() => {
			t.sendCredentialNotification('flow-1', 'notif-1', 'credential_accepted');
		}).not.toThrow();
	});
});

// ─── OIDFlowTransportWithRetry ────────────────────────────────────────────────

describe('OIDFlowTransportWithRetry.sendCredentialNotification', () => {
	it('delegates to inner transport', () => {
		const inner = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			isConnected: vi.fn(() => true),
			startOID4VCIFlow: vi.fn(),
			startOID4VPFlow: vi.fn(),
			request: vi.fn(),
			onProgress: vi.fn(() => () => {}),
			onError: vi.fn(() => () => {}),
			sendCredentialNotification: vi.fn(),
		};
		const retry = new OIDFlowTransportWithRetry(inner as any);
		retry.sendCredentialNotification('flow-1', 'notif-1', 'credential_accepted');
		expect(inner.sendCredentialNotification).toHaveBeenCalledWith(
			'flow-1', 'notif-1', 'credential_accepted',
		);
	});
});
