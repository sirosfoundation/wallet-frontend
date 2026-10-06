import { HttpClient } from '@sirosfoundation/http-client';
import { Logger } from '@sirosfoundation/browser-log';
import { HttpClient as HttpClientInterface } from './interfaces';

const client = new HttpClient({ isOnline: true, logger: new Logger() });

export const defaultHttpClient: HttpClientInterface = {
	get: (url, headers, opts) =>
		client.get(url, headers as Record<string, string>, opts),
	post: (url, body, headers, opts) =>
		client.post(url, body, headers as Record<string, string>, opts),
};
