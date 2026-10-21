import type { ProveError } from './types';

export enum ZkpPresenterHosts {
	IN_PAGE = 'in-page',
	NATIVE_WRAPPER = 'native-wrapper',
}

export enum ZkpPresenterHostPriority {
	IN_PAGE = 0,
	NATIVE_WRAPPER = 10,
}

export type ZkpReqErrorCode = 'invalid_request' | 'access_denied';

/**
 * A failure the wallet answers with `code`.
 */
export class ZkpReqError extends Error {
	readonly code: ZkpReqErrorCode;

	constructor(code: ZkpReqErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = 'ZkpReqError';
	}
}

/**
 * The presenter's {@link ProveError}, wrapped by a host so the wallet gets a real error.
 */
export class ZkpProveError extends Error {
	readonly reason: ProveError['reason'];
	readonly candidate: ProveError['candidate'];
	readonly errors?: ProveError['errors'];

	constructor(proveError: ProveError) {
		super(`Proving failed: ${proveError.reason}`);
		this.name = 'ZkpProveError';
		this.reason = proveError.reason;
		this.candidate = proveError.candidate;
		this.errors = proveError.errors;
	}
}

/**
 * Whether a rejection from the presenter is its plain {@link ProveError}.
 */
export function isProveError(value: unknown): value is ProveError {
	if (typeof value !== 'object' || value === null) return false;

	const candidateError = value as Record<string, unknown>;
	return (
		(candidateError.reason === 'failed' ||
			candidateError.reason === 'cancelled' ||
			candidateError.reason === 'unavailable') &&
		typeof candidateError.candidate === 'object' &&
		candidateError.candidate !== null
	);
}
