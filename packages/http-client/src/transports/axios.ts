import { HttpClientError } from '../resources';
import { HttpTransport } from '../types';
import axios from 'axios';

/**
 * Axios-based HTTP transport for the HttpClient.
 * Handles GET and POST requests and returns responses in a standardized format.
 */
export const axiosHttpTransport: HttpTransport = async ({
	method,
	url,
	body,
	headers,
	timeout,
}) => {
	try {
		const response = await axios.request({
			method,
			url,
			data: body,
			timeout: timeout ?? 10 * 1000,
			validateStatus: () => true,
			headers,
			responseType: 'arraybuffer',
		});
		return {
			status: response.status,
			headers: response.headers as Record<string, unknown>,
			body: new Uint8Array(response.data as ArrayBuffer),
		};
	} catch (err: any) {
		throw new HttpClientError(
			method,
			err.response?.status || 500,
			err.response?.headers || {},
			err.message || `${method} request failed`,
		);
	}
};
