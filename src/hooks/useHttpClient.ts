import { useContext, useMemo } from 'react';
import StatusContext from '@/context/StatusContext';
import HttpClient from '@/lib/services/HttpClient';
import SessionContext from '@/context/SessionContext';

export function useHttpClient(): HttpClient {
	const { isOnline } = useContext(StatusContext);
	const { obliviousKeyConfig } = useContext(SessionContext);

	const client = useMemo(() =>
		new HttpClient(isOnline, obliviousKeyConfig),
		[isOnline, obliviousKeyConfig]
	);

	return client;
}
