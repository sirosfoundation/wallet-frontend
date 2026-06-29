import { z } from 'zod';

export const TokenResponseSchema = z.object({
	access_token: z.string(),
	token_type: z.literal('Bearer'),
	expires_in: z.number(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const AccessTokenPayloadSchema = z.object({
	sub: z.string(),
	aud: z.string(),
	tenant_id: z.string(),
	tac: z.string(),
	acr: z.enum(['urn:siros:acr:passkey', 'urn:siros:acr:oidc']),
	exp: z.number(),
});
export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthTokenError';
	}
}
