import { z } from 'zod';
import { ICircuitZkVpFormat } from '../types';
import { CircuitZkError } from '../resources';

type CircuitZkVpFormatOptions = {
	circuitProofSystemValues?: string[];
	circuitIdValues?: string[];
};

export class CircuitZkVpFormat implements ICircuitZkVpFormat {
	readonly circuitProofSystemValues?: string[];
	readonly circuitIdValues?: string[];

	private constructor(options: CircuitZkVpFormatOptions) {
		if (
			Array.isArray(options.circuitProofSystemValues) &&
			options.circuitProofSystemValues.length === 0
		) {
			throw new CircuitZkError(
				'invalid_request',
				'circuitProofSystemValues must be non-empty if provided',
			);
		}
		if (
			Array.isArray(options.circuitIdValues) &&
			options.circuitIdValues.length === 0
		) {
			throw new CircuitZkError(
				'invalid_request',
				'circuitIdValues must be non-empty if provided',
			);
		}

		this.circuitProofSystemValues = options.circuitProofSystemValues;
		this.circuitIdValues = options.circuitIdValues;
	}

	/**
	 * Create a `CircuitZkVpFormat` instance from the client's metadata.
	 *
	 * @throws {CircuitZkError} If the client metadata is invalid according
	 * 													to the rulebook.
	 */
	static fromClientMetadata(
		clientMetadata: Record<string, any>,
	): CircuitZkVpFormat {
		const { success, data, error } =
			clientMetadataSchema.safeParse(clientMetadata);
		if (!success) {
			throw new CircuitZkError(
				'invalid_request',
				`Invalid client metadata: ${error.message}`,
			);
		}

		const czk = data.vp_formats_supported?.circuit_zk;
		return new CircuitZkVpFormat({
			circuitProofSystemValues: czk?.circuit_proof_system_values,
			circuitIdValues: czk?.circuit_id_values,
		});
	}
}

const circuitProofSystemValuesSchema = z.array(z.string()).min(1).optional();
const circuitIdValuesSchema = z.array(z.string()).min(1).optional();

const clientMetadataSchema = z.object({
	vp_formats_supported: z
		.object({
			circuit_zk: z
				.object({
					circuit_proof_system_values: circuitProofSystemValuesSchema,
					circuit_id_values: circuitIdValuesSchema,
				})
				.optional(),
		})
		.optional(),
});
