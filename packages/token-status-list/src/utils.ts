import { base64url } from 'jose';
import { TokenStatus, TokenStatusListsError } from './resources';
import { z } from 'zod';
import { TokenEntity } from './types';

const statusClaimSchema = z.object({
	iat: z.number().optional(),
	status: z.object({
		status_list: z.object({
			idx: z.number().int().nonnegative(),
			uri: z.string(),
		}),
	}),
});

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
			return TokenStatus.UNKNOWN;
	}
}

export function getStatusListRef(claims: unknown): TokenEntity | undefined {
	const result = statusClaimSchema.safeParse(claims);
	if (!result.success) return undefined;

	const { status, iat } = result.data;
	const { uri, idx } = status.status_list;
	return { uri, idx, iat };
}
