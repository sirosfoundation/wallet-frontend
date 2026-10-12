import { renderHook } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it } from 'vitest';
import { WscdManagerClientContext } from '@/context/WscdManagerClientContext';
import type { IWscdManagerClient } from '@/lib/wscd-manager';
import { useWscdManagerClient } from './useWscdManagerClient';

function wrapperWith(value: IWscdManagerClient | null) {
	return ({ children }: { children: React.ReactNode }) => (
		<WscdManagerClientContext.Provider value={{ wscdManagerClient: value }}>
			{children}
		</WscdManagerClientContext.Provider>
	);
}

describe('useWscdManagerClient', () => {
	it('throws when used outside a provider', () => {
		expect(() => renderHook(() => useWscdManagerClient())).toThrow(
			// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
			'useWscdManagerClient must be used within a WscdManagerClientContextProvider',
		);
	});

	it('returns the client when the provider holds one', () => {
		const client = { id: 'fake-client' } as unknown as IWscdManagerClient;

		const { result } = renderHook(() => useWscdManagerClient(), {
			wrapper: wrapperWith(client),
		});

		expect(result.current).toBe(client);
	});

	it('returns null in the pre-init window', () => {
		const { result } = renderHook(() => useWscdManagerClient(), {
			wrapper: wrapperWith(null),
		});

		expect(result.current).toBeNull();
	});
});
