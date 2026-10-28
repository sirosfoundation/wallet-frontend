export class HttpClientError extends Error {
	status: number;
	headers: Record<string, unknown>;
	responseData: unknown;

	constructor(
		method: string,
		status: number,
		headers: Record<string, unknown>,
		data: unknown,
	) {
		super(`${method} request failed`);
		this.status = status;
		this.headers = headers;
		this.responseData = data;
	}
}
