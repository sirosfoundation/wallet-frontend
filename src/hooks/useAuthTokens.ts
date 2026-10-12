import { useContext } from 'react';
import SessionContext from '@/context/SessionContext';
import type { AuthTokens } from '@/lib/auth';

export function useAuthTokens(): AuthTokens {
	const sessionContext = useContext(SessionContext);

	if (!sessionContext) {
		throw new Error('useAuthTokens must be used within a SessionContextProvider');
	}
	return sessionContext.authTokens;
}
