import { useMemo } from 'react';
import { AuthTokens } from '@/lib/auth';
import { getTenantFromUrlPath } from '@/lib/tenant';
import { useAuthServerClient } from './useAuthServerClient';

export function useAuthTokens(): AuthTokens {
	const authServerClient = useAuthServerClient();
	const tenantId = getTenantFromUrlPath();

	const authTokens = useMemo(
		() => AuthTokens.fromStorage({ authServerClient, tenantId }),
		[authServerClient, tenantId],
	);

	return authTokens;
}
