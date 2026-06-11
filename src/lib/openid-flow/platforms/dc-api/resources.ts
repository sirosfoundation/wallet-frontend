import { DcqlQuery } from 'dcql';
import { z } from 'zod';

export interface DCAPIMode {
	readonly verifiedOrigin: string;
	originHandshake(requestId: string, expectedOrigins: string[]): Promise<string>;
	send(response: DCAPIResponse): void;
	close(): void;
}

export type DCApiResponseMode = z.infer<typeof DCApiResponseModeSchema>;
export const DCApiResponseModeSchema = z
	.enum(['dc_api', 'dc_api.jwt'], {
		errorMap: () => ({ message: "response_mode must be 'dc_api' or 'dc_api.jwt'" }),
	})
	.default('dc_api');

export type KeyMaterial = z.infer<typeof KeyMaterialSchema>;
export const KeyMaterialSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('x5c'), value: z.array(z.string()) }),
	z.object({ type: z.literal('jwk'), value: z.object({}).passthrough() }),
	z.object({ type: z.literal('kid'), value: z.string() }),
]);

export type ClientMetadata = z.infer<typeof ClientMetadataSchema>;
export const ClientMetadataSchema = z.object({
	jwks: z.object({
		keys: z.array(z.object({}).passthrough()),
	}).optional(),
	authorization_encrypted_response_alg: z.string().optional(),
	authorization_encrypted_response_enc: z.string().optional(),
}).passthrough();

export const dcqlQuerySchema = z.custom<DcqlQuery.Input>(
	(val) => {
		if (!val || typeof val !== 'object') return false;
		try {
			DcqlQuery.parse(val);
			return true;
		} catch {
			return false;
		}
	},
	{ message: 'Invalid dcql_query' }
);

const BaseDCApiRequestSchema = z.object({
	nonce: z.string({ required_error: 'Missing required nonce parameter' }).min(1, 'nonce cannot be empty'),
	dcqlQuery: dcqlQuerySchema,
	responseMode: DCApiResponseModeSchema,
}).strict();

export type SignedDCAPIRequest = z.infer<typeof SignedDCApiRequestSchema>;
export const SignedDCApiRequestSchema = BaseDCApiRequestSchema.extend({
	clientId: z.string({ required_error: 'Missing client_id in JWT payload' }).min(1, 'client_id cannot be empty'),
	keyMaterial: KeyMaterialSchema,
	rawJwt: z.string().min(1),
	expectedOrigins: z.array(z.string(), { required_error: 'Missing expected_origins in signed request' }),
	clientMetadata: ClientMetadataSchema.optional(),
}).strict();

export type UnsignedDCAPIRequest = z.infer<typeof UnsignedDCApiRequestSchema>;
export const UnsignedDCApiRequestSchema = BaseDCApiRequestSchema;

export type DCAPIResponse = {
	requestId: string;
	payload: Record<string, unknown>;
};
