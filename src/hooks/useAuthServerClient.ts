import { useMemo } from 'react';
import { AuthServerClient } from '@/lib/auth';
import { BACKEND_URL } from '@/config';

export function useAuthServerClient(): AuthServerClient {
	const authServerClient = useMemo(
		() => new AuthServerClient({ baseUrl: BACKEND_URL }),
		[],
	);

	return authServerClient;
}
