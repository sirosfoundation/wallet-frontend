import { DcqlQuery } from 'dcql';
import { z } from 'zod';

export interface DCAPIMode {
	readonly verifiedOrigin: string;
	originHandshake(requestId: string, expectedOrigins?: string[]): Promise<string>;
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

function normalizeDcqlQuery(dcqlQueryParam: any) {
    const normalized = structuredClone(dcqlQueryParam);
    let isZk = false;

    for (const cred of normalized.credentials) {
        if (cred.format === 'mso_mdoc_zk') {
            cred.format = 'mso_mdoc';
            isZk = true;
        }
    }

    normalized._isZk = isZk;
    return normalized;
}

export const dcqlQuerySchema = z.preprocess(
    (val) => {
        if (!val || typeof val !== 'object') return val;
        return normalizeDcqlQuery(val);
    },
    z.custom<DcqlQuery.Input>(
        (val) => {
            if (!val || typeof val !== 'object') return false;
            try {
                const { _isZk, ...rest } = val as any;
                DcqlQuery.parse(rest);
                console.log("dcql query normalized", val, "isZk:", _isZk);
                return true;
            } catch {
                return false;
            }
        },
        { message: 'Invalid dcql_query' }
    )
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

export type DCAPIResponse = {
	requestId: string;
	payload: Record<string, unknown>;
};
