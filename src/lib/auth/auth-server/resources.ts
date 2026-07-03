import { z } from 'zod';

export const LoginBeginResponseSchema = z.object({
	challengeId: z.string(),
	getOptions: z.object({
		publicKey: z.custom<PublicKeyCredentialRequestOptions>(),
	}),
});
export type LoginBeginResponse = z.infer<typeof LoginBeginResponseSchema>;

export const LoginFinishResponseSchema = z.object({
	uuid: z.string(),
	displayName: z.string(),
	tenantId: z.string(),
	tenantDisplayName: z.string(),
});
export type LoginFinishResponse = z.infer<typeof LoginFinishResponseSchema>;

export const RegisterBeginResponseSchema = z.object({
	challengeId: z.string(),
	createOptions: z.object({
		publicKey: z.custom<PublicKeyCredentialCreationOptions>(),
	}),
});
export type RegisterBeginResponse = z.infer<typeof RegisterBeginResponseSchema>;

export const RegisterFinishResponseSchema = z.object({
	uuid: z.string(),
	displayName: z.string(),
	tenantId: z.string(),
	tenantDisplayName: z.string(),
});
export type RegisterFinishResponse = z.infer<typeof RegisterFinishResponseSchema>;
