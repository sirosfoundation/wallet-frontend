import { useContext } from 'react';
import { AuthTokens } from '@/lib/auth';
import SessionContext from '@/context/SessionContext';

export function useAuthTokens(): AuthTokens {
	const sessionContext = useContext(SessionContext);

	if (!sessionContext) {
		throw new Error('useAuthTokens must be used within a SessionContextProvider');
	}
	return sessionContext.authTokens;
}
