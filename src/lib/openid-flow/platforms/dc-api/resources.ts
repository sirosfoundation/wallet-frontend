import { DcqlQuery } from 'dcql';
import { z } from 'zod';

export interface DCAPIMode {
	readonly verifiedOrigin: string;
	initialize(envelope: DCAPIEnvelope): Promise<void>;
	originHandshake(envelope: DCAPIEnvelope, expectedOrigins?: string[]): Promise<string>;
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
	expectedOrigins: z.array(z.string(), { required_error: 'Missing expected_origins in signed request' }).min(1, 'expected_origins cannot be empty'),
	clientMetadata: ClientMetadataSchema.optional(),
}).strict();

export type UnsignedDCAPIRequest = z.infer<typeof UnsignedDCApiRequestSchema>;
export const UnsignedDCApiRequestSchema = BaseDCApiRequestSchema;

export type DCAPIRequestProtocol = z.infer<typeof DCAPIRequestProtocolSchema>;
export const DCAPIRequestProtocolSchema = z.enum([
	'openid4vp-v1',
	'openid4vp-v1-unsigned',
	'openid4vp-v1-signed',
]);

export type DCAPIEnvelope = z.infer<typeof DCAPIEnvelopeSchema>;
export const DCAPIEnvelopeSchema = z.object({
	requestId: z
		.string({
			required_error: 'Missing request_id',
			invalid_type_error: 'Missing request_id',
		})
		.min(1, 'Missing request_id'),
	requestProtocol: DCAPIRequestProtocolSchema.optional(),
	requestOrigin: z.string().optional(),
	selectedCredentialIDs: z.array(z.string()).default([]),
});

export type DCAPIResponse = {
	requestId: string;
	payload: Record<string, unknown>;
};
