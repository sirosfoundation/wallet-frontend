import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useOID4VCIFlow from './useOID4VCIFlow';

const { transport } = vi.hoisted(() => ({
	transport: {
		releaseFlow: vi.fn(),
		startOID4VCIFlow: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	},
}));

vi.mock('@/context/OIDFlowTransportContext', () => ({
	useOIDFlowTransportSafe: () => ({ transport, transportType: 'websocket' }),
}));

describe('useOID4VCIFlow: aborting a flow reaches the transport', () => {
	it('releases what the transport holds for the flow when the hook unmounts', () => {
		transport.releaseFlow.mockClear();
		const { unmount } = renderHook(() => useOID4VCIFlow());
		expect(transport.releaseFlow).not.toHaveBeenCalled();

		unmount();

		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('releases it when starting the flow fails locally', async () => {
		transport.releaseFlow.mockClear();
		transport.startOID4VCIFlow.mockRejectedValue(new Error('boom'));
		const { result } = renderHook(() => useOID4VCIFlow());

		const outcome = await result.current.handleCredentialOffer(new URL('openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer'));

		expect(outcome.success).toBe(false);
		expect(transport.releaseFlow).toHaveBeenCalled();
	});
});
