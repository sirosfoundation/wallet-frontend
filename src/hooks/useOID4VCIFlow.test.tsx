import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import CredentialsContext, { type CredentialsContextValue } from '@/context/CredentialsContext';
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

// The credentials context has no default value: the hook needs a provider (only the engine is read here).
const credentials = { credentialEngine: new Promise(() => undefined) } as unknown as CredentialsContextValue;
const wrapper = ({ children }: { children: ReactNode }) => (
	<CredentialsContext.Provider value={credentials}>{children}</CredentialsContext.Provider>
);

describe('useOID4VCIFlow: aborting a flow reaches the transport', () => {
	it('releases what the transport holds for the flow when the hook unmounts', () => {
		transport.releaseFlow.mockClear();
		const { unmount } = renderHook(() => useOID4VCIFlow(), { wrapper });
		expect(transport.releaseFlow).not.toHaveBeenCalled();

		unmount();

		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('does not release a second time when the aborted flow’s request then fails (it could hit a newer flow)', async () => {
		transport.releaseFlow.mockClear();
		let failStart!: (reason: Error) => void;
		transport.startOID4VCIFlow.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					failStart = reject;
				}),
		);
		const { result, unmount } = renderHook(() => useOID4VCIFlow(), { wrapper });
		const outcome = result.current.handleCredentialOffer(new URL('openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer'));
		await vi.waitFor(() => expect(failStart).toBeTypeOf('function'));

		unmount();
		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
		failStart(new Error('The flow was released locally'));
		const settled = await outcome;

		expect(settled.error?.code).toBe('ABORTED');
		expect(transport.releaseFlow).toHaveBeenCalledTimes(1);
	});

	it('releases it when starting the flow fails locally', async () => {
		transport.releaseFlow.mockClear();
		transport.startOID4VCIFlow.mockRejectedValue(new Error('boom'));
		const { result } = renderHook(() => useOID4VCIFlow(), { wrapper });

		const outcome = await result.current.handleCredentialOffer(new URL('openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer'));

		expect(outcome.success).toBe(false);
		expect(transport.releaseFlow).toHaveBeenCalled();
	});
});
