import { ZkpReqError, credentialQuerySchema } from '../resources';
import type {
	SystemId,
	ZkpReqSelection,
	IZkpReqCredentialQuery,
	IZkpReqCredentialQueryMeta,
	IZkpReqReqFunction,
	ProofSystem,
} from '../types';
import { ZkpReqReqFunction } from './ZkpReqReqFunction';

export class ZkpReqCredentialQuery implements IZkpReqCredentialQuery {
	readonly id: string;
	readonly format = 'zkp_req' as const;
	readonly meta: IZkpReqCredentialQueryMeta;
	readonly requireCryptographicHolderBinding?: true;
	readonly functions: IZkpReqReqFunction[];

	#selection?: ZkpReqSelection;

	constructor(credential: unknown) {
		const { success, data, error } =
			credentialQuerySchema.safeParse(credential);
		if (!success) {
			throw new ZkpReqError(
				'invalid_request',
				`Invalid credential query: ${error.message}`,
			);
		}

		this.id = data.id;
		this.meta = {
			sourceFormat: data.meta.source_format,
			docTypeValue: data.meta.doctype_value,
			schemaIdValue: data.meta.schema_id_value,
			vctValues: data.meta.vct_values,
		};
		this.requireCryptographicHolderBinding =
			data.require_cryptographic_holder_binding;
		this.functions = data._req.map((f) => new ZkpReqReqFunction({
			fnId: f.fn_id,
			return: f.return,
			params: f.params,
		}));
	}

	setResolved(selection: ZkpReqSelection) {
		this.#selection = selection;
	}

	selection(): ZkpReqSelection {
		if (this.#selection === undefined) {
			throw new Error(
				'System not resolved; call resolveRequestSystems() first',
			);
		}
		return this.#selection;
	}

	systemId(): SystemId {
		if (this.#selection === undefined) {
			throw new Error(
				'System not resolved; call resolveRequestSystems() first',
			);
		}
		return this.#selection.systemId;
	}

	proofSystem(): ProofSystem {
		if (this.#selection === undefined) {
			throw new Error(
				'Proof system not resolved; call resolveRequestSystems() first',
			);
		}
		return this.#selection.proofSystem;
	}
}
