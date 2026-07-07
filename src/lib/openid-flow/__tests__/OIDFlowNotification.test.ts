/**
 * Tests for OID4VCI §10 credential notification across transports.
 *
 * Ensures sendCredentialNotification is a safe no-op on the base transport
 * and that the retry decorator delegates correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { OIDFlowTransportWithRetry } from '../decorators/OIDFlowTransportWithRetry';
import { NullOIDFlowTransport } from '../types/IOIDFlowTransport';

describe('sendCredentialNotification', () => {
	it('is a no-op on NullOIDFlowTransport', () => {
		const t = new NullOIDFlowTransport();
		expect(() => {
			t.sendCredentialNotification('f', 'n', 'credential_accepted');
		}).not.toThrow();
	});

	it('delegates through OIDFlowTransportWithRetry', () => {
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
