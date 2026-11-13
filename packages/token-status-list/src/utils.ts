import { base64url } from 'jose';
import { TokenStatus, TokenStatusListsError } from './resources';
import { TokenBatchInstance } from './types';

// Draft §7.1: values 0x04-0x0B are reserved for future registration.
const RESERVED_STATUS_MIN = 0x04;
const RESERVED_STATUS_MAX = 0x0b;

export async function decompressStatusListToArray(
	list: string,
): Promise<Uint8Array> {
	try {
		const byteArray = base64url.decode(list);

		const stream = new Blob([new Uint8Array(byteArray)])
			.stream()
			.pipeThrough(new DecompressionStream('deflate'));

		const statuses = new Uint8Array(await new Response(stream).arrayBuffer());

		return statuses;
	} catch (e) {
		throw new TokenStatusListsError('malformed');
	}
}

export function readTokenStatusFromArray(
	list: Uint8Array,
	bits: number,
	idx: number,
): number {
	const bitsBeforeEntry = idx * bits;
	const byteIdx = Math.floor(bitsBeforeEntry / 8);

	if (byteIdx >= list.length) {
		throw new TokenStatusListsError('out_of_range');
	}

	const bitOffset = bitsBeforeEntry % 8;
	const mask = (1 << bits) - 1;
	const status = (list[byteIdx] >> bitOffset) & mask;

	return status;
}

export function resolveTokenStatus(status: number): TokenStatus {
	switch (status) {
		case TokenStatus.VALID:
			return TokenStatus.VALID;
		case TokenStatus.INVALID:
			return TokenStatus.INVALID;
		case TokenStatus.SUSPENDED:
			return TokenStatus.SUSPENDED;
		default:
			return status >= RESERVED_STATUS_MIN && status <= RESERVED_STATUS_MAX
				? TokenStatus.REJECTED
				: TokenStatus.UNKNOWN;
	}
}

// Worst first.
const BLOCKED_STATUSES = [
	TokenStatus.INVALID,
	TokenStatus.REJECTED,
	TokenStatus.SUSPENDED,
];
// Best first.
const USABLE_STATUSES = [
	TokenStatus.VALID,
	TokenStatus.PENDING,
	TokenStatus.UNKNOWN,
];

/**
 * Status of a token batch, from its unused instances,
 * or all of them once every one is used.
 */
export function deriveTokenBatchStatus(
	instances: TokenBatchInstance[],
): TokenStatus | undefined {
	const unused = instances.filter((i) => i.spent === false);
	const relevant = unused.length > 0 ? unused : instances;

	if (
		relevant.length > 0 &&
		relevant.every((i) => TokenStatus.isBlocked(i.status))
	) {
		return BLOCKED_STATUSES.find((status) =>
			relevant.some((i) => i.status === status),
		);
	}

	return USABLE_STATUSES.find((status) =>
		relevant.some((i) => i.status === status),
	);
}
