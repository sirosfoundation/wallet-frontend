import { useContext, useRef } from 'react';
import StatusContext from '@/context/StatusContext';
import HttpClient from '@/lib/services/HttpClient';
import SessionContext from '@/context/SessionContext';

export function useHttpClient(): HttpClient {
	const { isOnline } = useContext(StatusContext);
	const { obliviousKeyConfig } = useContext(SessionContext);

	const clientRef = useRef<HttpClient | null>(null);

	if (!clientRef.current) {
		clientRef.current = new HttpClient(isOnline, obliviousKeyConfig);
	} else {
		clientRef.current.setIsOnline(isOnline);
		clientRef.current.setObliviousKeyConfig(obliviousKeyConfig);
	}

	return clientRef.current;
}
