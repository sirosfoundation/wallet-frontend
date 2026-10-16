import { CircuitZkError, credentialQuerySchema } from '../resources';
import type {
	CircuitId,
	CircuitZkSelection,
	ICircuitZkCredentialQuery,
	ICircuitZkCredentialQueryMeta,
	ICircuitZkReqFunction,
	ProofSystem,
} from '../types';
import { CircuitZkReqFunction } from './CircuitZkReqFunction';

export class CircuitZkCredentialQuery implements ICircuitZkCredentialQuery {
	readonly id: string;
	readonly format = 'circuit_zk' as const;
	readonly meta: ICircuitZkCredentialQueryMeta;
	readonly requireCryptographicHolderBinding?: true;
	readonly functions: ICircuitZkReqFunction[];

	#selection?: CircuitZkSelection;

	constructor(credential: unknown) {
		const { success, data, error } =
			credentialQuerySchema.safeParse(credential);
		if (!success) {
			throw new CircuitZkError(
				'invalid_request',
				`Invalid credential query: ${error.message}`,
			);
		}

		this.id = data.id;
		this.meta = {
			docTypeValue: data.meta.doctype_value,
			vctValues: data.meta.vct_values,
			sourceFormat: data.meta.source_format,
		};
		this.requireCryptographicHolderBinding =
			data.require_cryptographic_holder_binding;
		this.functions = data.claims._req.map((f) => new CircuitZkReqFunction({
			fnId: f.fn_id,
			id: f.id,
			params: f.params,
		}));
	}

	setResolved(selection: CircuitZkSelection) {
		this.#selection = selection;
	}

	selection(): CircuitZkSelection {
		if (this.#selection === undefined) {
			throw new Error(
				'Circuit not resolved; call resolveRequestCircuits() first',
			);
		}
		return this.#selection;
	}

	circuitId(): CircuitId {
		if (this.#selection === undefined) {
			throw new Error(
				'Circuit not resolved; call resolveRequestCircuits() first',
			);
		}
		return this.#selection.circuitId;
	}

	proofSystem(): ProofSystem {
		if (this.#selection === undefined) {
			throw new Error(
				'Proof system not resolved; call resolveRequestCircuits() first',
			);
		}
		return this.#selection.proofSystem;
	}
}
