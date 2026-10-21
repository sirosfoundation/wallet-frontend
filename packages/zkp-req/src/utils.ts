import { ZkpFormats, ZkpQuery } from "./types";

/**
 * Checks if a given DCQL query contains any credentials with the 'zkp_req'
 * format. If so, we treat it as a zkp_req request.
 */
export function isZkpReqDcqlQuery(query: unknown): boolean {
	if (
		!query ||
		typeof query !== 'object' ||
		!('credentials' in query) ||
		!Array.isArray(query.credentials)
	) return false;

	return query.credentials.filter((cred) => {
		return cred.format === 'zkp_req';
	}).length > 0;
}

/**
 * We don't want to accept requests that mix zkp_req credentials
 * with other types of credentials.
 */
export function isPureZkpReqDcqlQuery(query: unknown): boolean {
	if (
		!query ||
		typeof query !== 'object' ||
		!('credentials' in query) ||
		!Array.isArray(query.credentials) ||
		query.credentials.length === 0
	) return false;

	return query.credentials.filter((cred) => {
		return cred.format === 'zkp_req';
	}).length === query.credentials.length;
}

/**
 * The `zkp_req` credential queries, with only the members {@link ZkpQuery} defines.
 * Expects a query already checked with {@link isPureZkpReqDcqlQuery}.
 */
export function zkpReqQueriesOf(query: unknown): Array<{ id: string } & ZkpQuery> {
	const credentials = (query as { credentials?: Array<{ id: string } & ZkpQuery> } | undefined)?.credentials ?? [];

	return credentials.map(
		({ id, meta, _req, trusted_authorities, require_cryptographic_holder_binding }) =>
			({ id, meta, _req, trusted_authorities, require_cryptographic_holder_binding }),
	);
}

/**
 * `vp_formats_supported.zkp_req` from the verifier's `client_metadata`.
 * Members that are not arrays of strings are dropped.
 */
export function zkpReqFormatsOf(clientMetadata: unknown): ZkpFormats {
	const formats = (clientMetadata as { vp_formats_supported?: { zkp_req?: Record<string, unknown> } } | undefined)
		?.vp_formats_supported?.zkp_req;

	const strings = (value: unknown): string[] | undefined =>
		Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

	const proof_system_values = strings(formats?.proof_system_values);
	const system_id_values = strings(formats?.system_id_values);

	return {
		...(proof_system_values && { proof_system_values }),
		...(system_id_values && { system_id_values }),
	};
}
