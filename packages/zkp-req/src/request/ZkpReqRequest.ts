import {
	assertAttestationPolicies,
	AttestationPolicyViolation,
	attestationSourceAttributes,
} from '../attestation-policies';
import { ZkpReqError, dcqlQuerySchema } from '../resources';
import type {
	ZkpReqCredentialCriteria,
	ZkpReqSelectionCriteria,
	IZkpReqCredentialQuery,
	IZkpReqProver,
	IZkpReqRegistry,
	IZkpReqRequest,
	IZkpReqVpFormat,
} from '../types';
import { ZkpReqCredentialQuery } from './ZkpReqCredentialQuery';

export class ZkpReqRequest implements IZkpReqRequest {
	readonly supportedFormat?: IZkpReqVpFormat;
	readonly credentials: IZkpReqCredentialQuery[];

	#registry: IZkpReqRegistry;
	#prover: IZkpReqProver;

	constructor(options: {
		dcqlQuery: unknown;
		vpFormat: IZkpReqVpFormat;
		registry: IZkpReqRegistry;
		prover: IZkpReqProver;
	}) {
		this.supportedFormat = options.vpFormat;
		this.#registry = options.registry;
		this.#prover = options.prover;

		const { success, data, error } = dcqlQuerySchema.safeParse(
			options.dcqlQuery,
		);

		if (!success) {
			throw new ZkpReqError(
				'invalid_request',
				`Invalid DCQL query: ${error.message}`,
			);
		}

		this.credentials = data.credentials.map((c) => {
			const cred = new ZkpReqCredentialQuery(c);

			try {
				assertAttestationPolicies(cred);
			} catch (err) {
				if (!(err instanceof AttestationPolicyViolation)) throw err;

				throw new ZkpReqError(
					'invalid_request',
					`Attestation policy violation for credential '${cred.id}': ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			return cred;
		});
	}

	async resolveRequestSystems(): Promise<void> {
		const supportedProofSystems = await this.#prover.supportedProofSystems();

		await Promise.all(
			this.credentials.map(async (cred) => {
				const typeValue = cred.meta.docTypeValue ?? cred.meta.schemaIdValue;
				if (!typeValue) {
					throw new ZkpReqError(
						'invalid_request',
						'vct-based zkp_req not supported',
					);
				}

				// verifier-accepted ∩ wallet-runnable; if the verifier didn't list any,
				// fall back to all wallet-runnable
				const acceptedSystems = this.supportedFormat?.proofSystemValues
					? this.supportedFormat.proofSystemValues.filter((s) =>
							supportedProofSystems.has(s),
						)
					: [...supportedProofSystems];

				const criteria: ZkpReqSelectionCriteria = {
					sourceFormat: cred.meta.sourceFormat,
					typeValue,
					req: cred.functions.map((f) => f.serialize()),
					acceptedSystemIds: this.supportedFormat?.systemIdValues,
					acceptedSystems,
				};

				const selection = await this.#registry.selectSystem(criteria);
				if (!selection) {
					throw new ZkpReqError(
						'invalid_request',
						`No approved system for credential '${cred.id}'`,
					);
				}

				cred.setResolved(selection);
			}),
		);
	}

	credentialCriteria(): ZkpReqCredentialCriteria[] {
		return this.credentials.map((cred) => ({
			credentialQueryId: cred.id,
			doctype: cred.meta.docTypeValue,
			schemaId: cred.meta.schemaIdValue,
			vct: cred.meta.vctValues,
			sourceFormat: cred.meta.sourceFormat,
			requiredAttributes: attestationSourceAttributes(cred),
		}));
	}
}
