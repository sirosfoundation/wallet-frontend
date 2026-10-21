import z from 'zod';
import { JsonValue } from './types';


export enum ZkpReqRegistryHosts {
	IN_PAGE = 'in-page',
	NATIVE_WRAPPER = 'native-wrapper',
}

export enum ZkpReqHostPriority {
	IN_PAGE = 0,
	NATIVE_WRAPPER = 10,
}

export enum ZkpReqProverHosts {
	IN_PAGE = 'in-page',
	WORKER = 'worker',
	NATIVE_WRAPPER = 'native-wrapper',
}

export enum ZkpReqProverHostPriority {
	IN_PAGE = 0,
	WORKER = 10,
	NATIVE_WRAPPER = 20,
}

export type ZkpReqErrorCode = 'invalid_request' | 'access_denied';

export class ZkpReqError extends Error {
	readonly code: ZkpReqErrorCode;
	constructor(code: ZkpReqErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = 'ZkpReqError';
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

const TYPE_VALUE_KEY_BY_SOURCE_FORMAT: Record<
	string,
	'doctype_value' | 'schema_id_value' | 'vct_values'
> = {
	mso_mdoc: 'doctype_value',
	bbs_cd: 'schema_id_value',
	'dc+sd-jwt': 'vct_values',
};

export type SerializedCredentialMeta = z.infer<typeof credentialMetaSchema>;
export const credentialMetaSchema = z
	.object({
		source_format: z.string().min(1),
		doctype_value: z.string().optional(),
		schema_id_value: z.string().optional(),
		vct_values: z.array(z.string()).min(1).optional(),
	})
	.refine(
		(m) =>
			[m.doctype_value, m.schema_id_value, m.vct_values].filter(
				(v) => v !== undefined,
			).length === 1,
		{
			message:
				'meta MUST contain exactly one of doctype_value, schema_id_value or vct_values',
		},
	)
	.refine(
		(m) => {
			const key = TYPE_VALUE_KEY_BY_SOURCE_FORMAT[m.source_format];
			return key === undefined || m[key] !== undefined;
		},
		{ message: 'meta type value does not match source_format' },
	);

export type SerializedReqFunction = z.infer<typeof reqFunctionSchema>;
export const reqFunctionSchema = z.object({
	fn_id: z.string().min(1),
	return: z.string().min(1),
	params: z.record(jsonValueSchema).optional(),
});

export type SerializedCredentialQuery = z.infer<typeof credentialQuerySchema>;
export const credentialQuerySchema = z
	.object({
		id: z.string().min(1),
		format: z.literal('zkp_req'),
		// Generic DCQL members (OpenID4VP 1.0 §6.1) that zkp_req does not exclude.
		multiple: z.boolean().optional(),
		trusted_authorities: z.array(z.unknown()).optional(),
		meta: credentialMetaSchema,
		require_cryptographic_holder_binding: z.literal(true).optional(),
		_req: z
			.array(reqFunctionSchema)
			.min(1)
			.refine(
				(items) => new Set(items.map((i) => i.return)).size === items.length,
				{ message: '`return` handles MUST be unique within the credential query' },
			),
	})
	.strict();

export type SerializedDcqlQuery = z.infer<typeof dcqlQuerySchema>;
export const dcqlQuerySchema = z.object({
	credentials: z.array(z.unknown()).min(1),
});
