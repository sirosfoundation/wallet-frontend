/**
 * Checks if a given DCQL query contains any credentials with the 'circuit_zk'
 * format. If so, we treat it as a circuit_zk request.
 */
export function isCircuitZkDcqlQuery(query: unknown): boolean {
	if (
		!query ||
		typeof query !== 'object' ||
		!('credentials' in query) ||
		!Array.isArray(query.credentials)
	) return false;

	return query.credentials.filter((cred) => {
		return cred.format === 'circuit_zk';
	}).length > 0;
}

/**
 * We don't want to accept requests that mix circuit_zk credentials
 * with other types of credentials.
 */
export function isPureCircuitZkDcqlQuery(query: unknown): boolean {
	if (
		!query ||
		typeof query !== 'object' ||
		!('credentials' in query) ||
		!Array.isArray(query.credentials)
	) return false;

	return query.credentials.filter((cred) => {
		return cred.format === 'circuit_zk';
	}).length === query.credentials.length;
}
