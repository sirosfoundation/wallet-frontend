import { z } from 'zod';
import { IZkpReqVpFormat } from '../types';
import { ZkpReqError } from '../resources';

type ZkpReqVpFormatOptions = {
	proofSystemValues?: string[];
	systemIdValues?: string[];
};

export class ZkpReqVpFormat implements IZkpReqVpFormat {
	readonly proofSystemValues?: string[];
	readonly systemIdValues?: string[];

	private constructor(options: ZkpReqVpFormatOptions) {
		if (
			Array.isArray(options.proofSystemValues) &&
			options.proofSystemValues.length === 0
		) {
			throw new ZkpReqError(
				'invalid_request',
				'proofSystemValues must be non-empty if provided',
			);
		}
		if (
			Array.isArray(options.systemIdValues) &&
			options.systemIdValues.length === 0
		) {
			throw new ZkpReqError(
				'invalid_request',
				'systemIdValues must be non-empty if provided',
			);
		}

		this.proofSystemValues = options.proofSystemValues;
		this.systemIdValues = options.systemIdValues;
	}

	/**
	 * Create a `ZkpReqVpFormat` instance from the client's metadata.
	 *
	 * @throws {ZkpReqError} If the client metadata is invalid according
	 * 													to the rulebook.
	 */
	static fromClientMetadata(
		clientMetadata: Record<string, any>,
	): ZkpReqVpFormat {
		const { success, data, error } =
			clientMetadataSchema.safeParse(clientMetadata);
		if (!success) {
			throw new ZkpReqError(
				'invalid_request',
				`Invalid client metadata: ${error.message}`,
			);
		}

		const zkp = data.vp_formats_supported?.zkp_req;
		return new ZkpReqVpFormat({
			proofSystemValues: zkp?.proof_system_values,
			systemIdValues: zkp?.system_id_values,
		});
	}
}

const proofSystemValuesSchema = z.array(z.string()).min(1).optional();
const systemIdValuesSchema = z.array(z.string()).min(1).optional();

const clientMetadataSchema = z.object({
	vp_formats_supported: z
		.object({
			zkp_req: z
				.object({
					proof_system_values: proofSystemValuesSchema,
					system_id_values: systemIdValuesSchema,
				})
				.optional(),
		})
		.optional(),
});
