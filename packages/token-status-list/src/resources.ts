import z from 'zod';

/**
 * Token status values as per IETF list.
 * @link https://www.ietf.org/archive/id/draft-ietf-oauth-status-list-21.html#name-status-types-values
 */
export enum TokenStatus {
	/**
	 * Spec: status value 0x00 in the IETF Token Status List.
	 * @link https://www.ietf.org/archive/id/draft-ietf-oauth-status-list-21.html#section-7.1-3.1.1
	 */
	VALID = 0,
	/**
	 * Spec: status value 0x01 in the IETF Token Status List (revoked).
	 * @link https://www.ietf.org/archive/id/draft-ietf-oauth-status-list-21.html#section-7.1-3.2.1
	 */
	INVALID = 1,
	/**
	 * Spec: status value 0x02 in the IETF Token Status List.
	 * @link https://www.ietf.org/archive/id/draft-ietf-oauth-status-list-21.html#section-7.1-3.3.1
	 */
	SUSPENDED = 2,
	/**
	 * Not spec: any other list value (application-specific or reserved),
	 * or an index outside the list. Must not be shown as valid.
	 */
	UNKNOWN = -1,
	/**
	 * Not spec: the cached list was signed before the token was issued,
	 * so it says nothing about this token yet.
	 */
	PENDING = -2,
}

export namespace TokenStatus {
	export function label(status: TokenStatus): string {
		return TokenStatus[status].toLowerCase();
	}
}

export class TokenStatusListsError extends Error {
	constructor(
		public readonly kind: 'network' | 'auth' | 'untrusted' | 'malformed' | 'out_of_range' | 'storage' | 'rate_limited' | 'not_supported',
		public readonly uri?: string,
		options?: ErrorOptions,
	) {
		super(kind, options);
	}
}

const verifiedSchema = z.object({
	uri: z.string(),
	state: z.literal('verified'),
	bits: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
	lst: z.string(),
	iat: z.number(),
	exp: z.number().optional(),
	ttl: z.number().optional(),
	expires_at: z.number(),
	etag: z.string(),
	// We don't use this field at the moment.
	signer_trust: z.string().optional(),
});

const notModifiedSchema = z.object({
	uri: z.string(),
	state: z.literal('not_modified'),
	etag: z.string(),
	expires_at: z.number(),
	signer_trust: z.string(),
});

const undeterminedSchema = z.object({
	uri: z.string(),
	state: z.literal('undetermined'),
	// Plain string so a new backend reason doesn't break parsing.
	reason: z.string(),
});

export const statusListSchema = z
	.discriminatedUnion('state', [verifiedSchema, notModifiedSchema, undeterminedSchema])
	.transform((list) => {
		switch (list.state) {
			case 'verified':
			case 'not_modified': {
				const { expires_at, signer_trust, ...rest } = list;
				return { ...rest, expiresAt: expires_at, signerTrust: signer_trust };
			}
			case 'undetermined':
				return list;
		}
	});

export type StatusList = z.infer<typeof statusListSchema>;
export type StatusListApiResponse = z.infer<typeof statusListResponseSchema>;
export const statusListResponseSchema = z.object({
	results: z.array(statusListSchema),
});
