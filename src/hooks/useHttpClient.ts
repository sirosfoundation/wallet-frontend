import { axiosHttpTransport, HttpClient } from '@sirosfoundation/http-client';
import { useContext, useEffect, useRef } from 'react';
import { BACKEND_URL, OHTTP_RELAY } from '@/config';
import SessionContext from '@/context/SessionContext';
import StatusContext from '@/context/StatusContext';
// biome-ignore lint/performance/noNamespaceImport: baseline: pre-existing debt. should be fixed
import * as indexedDB from '@/indexedDB';
import { getTenantFromUrlPath } from '@/lib/tenant';
import { createOhttpTransport } from '@/lib/utils/ohttpTransport';
import { logger } from '@/logger';

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
					? { 'X-Tenant-ID': getTenantFromUrlPath() || 'default' }
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
