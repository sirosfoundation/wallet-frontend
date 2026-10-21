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
		!Array.isArray(query.credentials)
	) return false;

	return query.credentials.filter((cred) => {
		return cred.format === 'zkp_req';
	}).length === query.credentials.length;
}
