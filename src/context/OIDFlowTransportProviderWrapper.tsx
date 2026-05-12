/**
 * Flow Transport Provider Wrapper
 *
 * This wrapper component provides the authToken and tenantId from session storage
 * to the OIDFlowTransportProvider. It should be placed in the component
 * tree after SessionContextProvider.
 *
 * Phase 5 of Transport Abstraction
 */

import React from 'react';
import { OIDFlowTransportProvider } from './OIDFlowTransportContext';
import { useSessionStorage } from '@/hooks/useStorage';
import { getTenantFromUrlPath } from '@/lib/tenant';

interface OIDFlowTransportProviderWrapperProps {
	children: React.ReactNode;
}

/**
 * Wrapper that extracts the auth token from session storage
 * and provides it to OIDFlowTransportProvider
 */
export const OIDFlowTransportProviderWrapper: React.FC<OIDFlowTransportProviderWrapperProps> = ({
	children,
}) => {
	// Get the appToken from session storage
	// This is the same token used by the rest of the app
	const [appToken] = useSessionStorage<string | null>('appToken', null);

	// Synchronous localStorage fallback: if sessionStorage was wiped by a mobile
	// WebView external OAuth redirect, we need the backup token immediately on this
	// render — before the restore effect in useApi fires — so the WebSocket
	// handshake doesn't start with a null auth token.
	const effectiveAppToken = appToken ?? (() => {
		try {
			const backup = localStorage.getItem('appToken_webview_backup');
			return backup ? JSON.parse(backup) as string : null;
		} catch {
			return null;
		}
	})();

	// Get the tenant ID from URL path (more robust than sessionStorage)
	// URL structure: /id/{tenantId}/* -> returns tenantId, or 'default' for root paths
	const tenantId = getTenantFromUrlPath() ?? 'default';

	return (
		<OIDFlowTransportProvider authToken={effectiveAppToken} tenantId={tenantId}>
			{children}
		</OIDFlowTransportProvider>
	);
};

export default OIDFlowTransportProviderWrapper;
