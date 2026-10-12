import { useMemo } from 'react';
import { BACKEND_URL } from '@/config';
import { AuthServerClient } from '@/lib/auth';

export function useAuthServerClient(): AuthServerClient {
	const authServerClient = useMemo(() => new AuthServerClient({ baseUrl: BACKEND_URL }), []);

	return authServerClient;
}
