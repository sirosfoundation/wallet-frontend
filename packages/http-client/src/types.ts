export type HttpResponse = {
	status: number;
	headers: Record<string, unknown>;
	data: unknown;
	raw?: Uint8Array<ArrayBuffer>;
};

export type HttpClientRequestOptions = {
	useCache?: boolean;
	wantRaw?: boolean;
	binary?: boolean; // overrides the URL-extension heuristic
};

export type HttpTransportRequest = {
	method: 'GET' | 'POST';
	url: string;
	body?: string | object;
	headers: Record<string, string>;
	timeout?: number;
};

export type HttpTransportResponse = {
	status: number;
	headers: Record<string, unknown>;
	body: Uint8Array<ArrayBuffer>;
};

export type HttpTransport = (req: HttpTransportRequest) => Promise<HttpTransportResponse>;

export type IndexedDB = {
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	addItem(storeName: string, key: any, value: any, forceMappedStoreName?: string): Promise<void>;
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	getItem(storeName: string, key: any, forceMappedStoreName?: string): Promise<any>;
};

export type CachedData = {
	status: number;
	headers: Record<string, unknown>;
	bytes: Uint8Array<ArrayBuffer>;
	contentType?: string;
	binary: boolean;
};

export type CachedEntry = {
	data: CachedData;
	expiry: number;
};
