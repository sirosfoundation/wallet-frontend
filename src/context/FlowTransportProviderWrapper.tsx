/**
 * Flow Transport Provider Wrapper
 *
 * This wrapper component provides the authToken and tenantId from session storage
 * to the FlowTransportProvider. It should be placed in the component
 * tree after SessionContextProvider.
 *
 * Phase 5 of Transport Abstraction
 */

import React from 'react';
import { FlowTransportProvider } from './FlowTransportContext';
import { useSessionStorage } from '@/hooks/useStorage';
import { getStoredTenant } from '@/lib/tenant';

interface FlowTransportProviderWrapperProps {
	children: React.ReactNode;
}

/**
 * Wrapper that extracts the auth token from session storage
 * and provides it to FlowTransportProvider
 */
export const FlowTransportProviderWrapper: React.FC<FlowTransportProviderWrapperProps> = ({
	children,
}) => {
	// Get the appToken from session storage
	// This is the same token used by the rest of the app
	const [appToken] = useSessionStorage<string | null>('appToken', null);

	// Get the tenant ID (stored in sessionStorage by TenantContext)
	const tenantId = getStoredTenant() ?? 'default';

	return (
		<FlowTransportProvider authToken={appToken} tenantId={tenantId}>
			{children}
		</FlowTransportProvider>
	);
};

export default FlowTransportProviderWrapper;
