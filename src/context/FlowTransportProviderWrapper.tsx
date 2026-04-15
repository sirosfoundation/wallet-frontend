/**
 * Flow Transport Provider Wrapper
 *
 * This wrapper component provides the authToken and tenantId from session storage
 * to the FlowTransportProvider. It should be placed in the component
 * tree after SessionContextProvider.
 *
 * Phase 5 of Transport Abstraction
 */

import React, { useCallback, useContext } from 'react';
import { FlowTransportProvider } from './FlowTransportContext';
import SessionContext from './SessionContext';
import { useSessionStorage } from '@/hooks/useStorage';
import { getTenantFromUrlPath } from '@/lib/tenant';

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

	// Get the tenant ID from URL path (more robust than sessionStorage)
	// URL structure: /id/{tenantId}/* -> returns tenantId, or 'default' for root paths
	const tenantId = getTenantFromUrlPath() ?? 'default';

	// Use the api from SessionContext to refresh tokens before WS reconnect
	const { api } = useContext(SessionContext);
	const handleRefreshToken = useCallback(async (): Promise<string | null> => {
		const success = await api.refreshAccessToken();
		if (success) {
			return api.getAppToken();
		}
		return null;
	}, [api]);

	return (
		<FlowTransportProvider authToken={appToken} tenantId={tenantId} onRefreshToken={handleRefreshToken}>
			{children}
		</FlowTransportProvider>
	);
};

export default FlowTransportProviderWrapper;
