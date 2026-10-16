import z from 'zod';
import { JsonValue } from './types';


export enum CircuitZkRegistryHosts {
	IN_PAGE = 'in-page',
	NATIVE_WRAPPER = 'native-wrapper',
}

export enum CircuitZkHostPriority {
	IN_PAGE = 0,
	NATIVE_WRAPPER = 10,
}

export enum CircuitZkProverHosts {
	IN_PAGE = 'in-page',
	WORKER = 'worker',
	NATIVE_WRAPPER = 'native-wrapper',
}

export enum CircuitZkProverHostPriority {
	IN_PAGE = 0,
	WORKER = 10,
	NATIVE_WRAPPER = 20,
}

export type CircuitZkErrorCode = 'invalid_request' | 'access_denied';

export class CircuitZkError extends Error {
	readonly code: CircuitZkErrorCode;
	constructor(code: CircuitZkErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = 'CircuitZkError';
	}
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(jsonValueSchema),
	]),
);

export type SerializedCredentialMeta = z.infer<typeof credentialMetaSchema>;
export const credentialMetaSchema = z
	.object({
		doctype_value: z.string().optional(),
		vct_values: z.array(z.string()).min(1).optional(),
		source_format: z.string().optional(),
	})
	.refine(
		(m) => (m.doctype_value === undefined) !== (m.vct_values === undefined),
		{ message: 'meta MUST contain exactly one of doctype_value or vct_values' },
	);

export type SerializedReqFunction = z.infer<typeof reqFunctionSchema>;
export const reqFunctionSchema = z.object({
	fn_id: z.string().min(1),
	id: z.string().min(1),
	params: jsonValueSchema.optional(),
});

export type SerializedCredentialQuery = z.infer<typeof credentialQuerySchema>;
export const credentialQuerySchema = z.object({
	id: z.string().min(1),
	format: z.literal('circuit_zk'),
	meta: credentialMetaSchema,
	require_cryptographic_holder_binding: z.literal(true).optional(),
	claims: z.object({
		_req: z.array(reqFunctionSchema).min(1),
	}),
});

export type SerializedDcqlQuery = z.infer<typeof dcqlQuerySchema>;
export const dcqlQuerySchema = z.object({
	credentials: z.array(z.unknown()).min(1),
});
