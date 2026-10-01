import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { WscdManagerClientContext } from '@/context/WscdManagerClientContext';
import { IWscdManagerClient } from '@/lib/wscd-manager';
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
