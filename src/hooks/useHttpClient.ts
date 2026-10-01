import { useContext, useRef, useEffect } from 'react';
import { axiosHttpTransport, HttpClient } from '@sirosfoundation/http-client';
import StatusContext from '@/context/StatusContext';
import SessionContext from '@/context/SessionContext';
import { BACKEND_URL, OHTTP_RELAY } from '@/config';
import { logger } from '@/logger';
import * as indexedDB from '@/indexedDB';
import { createOhttpTransport } from '@/lib/utils/ohttpTransport';
import { getTenantFromUrlPath } from '@/lib/tenant';

export function useHttpClient(): HttpClient {
	const { isOnline } = useContext(StatusContext);
	const { obliviousKeyConfig } = useContext(SessionContext);
	const clientRef = useRef<HttpClient | null>(null);

	const transport = obliviousKeyConfig
		? createOhttpTransport(OHTTP_RELAY, obliviousKeyConfig)
		: axiosHttpTransport;

	if (!clientRef.current) {
		clientRef.current = new HttpClient({
			isOnline,
			logger,
			indexedDB,
			transport,
			decorateHeaders: ({ url }) =>
				new URL(url).origin === new URL(BACKEND_URL).origin
					? { 'X-Tenant-ID': getTenantFromUrlPath() }
					: {},
		});
	} else {
		clientRef.current.setIsOnline(isOnline);
		clientRef.current.setTransport(transport);
	}

	useEffect(() => {
		clientRef.current?.setIsOnline(isOnline);
		clientRef.current?.setTransport(transport);
	}, [isOnline, transport]);


	return clientRef.current;
}
