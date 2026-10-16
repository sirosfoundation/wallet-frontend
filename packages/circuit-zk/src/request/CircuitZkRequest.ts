import {
	assertAttestationPolicies,
	AttestationPolicyViolation,
	attestationSourceAttributes,
} from '../attestation-policies';
import { CircuitZkError, dcqlQuerySchema } from '../resources';
import type {
	CircuitZkCredentialCriteria,
	CircuitZkSelectionCriteria,
	ICircuitZkCredentialQuery,
	ICircuitZkProver,
	ICircuitZkRegistry,
	ICircuitZkRequest,
	ICircuitZkVpFormat,
} from '../types';
import { CircuitZkCredentialQuery } from './CircuitZkCredentialQuery';

export class CircuitZkRequest implements ICircuitZkRequest {
	readonly supportedFormat?: ICircuitZkVpFormat;
	readonly credentials: ICircuitZkCredentialQuery[];

	#registry: ICircuitZkRegistry;
	#prover: ICircuitZkProver;

	constructor(options: {
		dcqlQuery: unknown;
		vpFormat: ICircuitZkVpFormat;
		registry: ICircuitZkRegistry;
		prover: ICircuitZkProver;
	}) {
		this.supportedFormat = options.vpFormat;
		this.#registry = options.registry;
		this.#prover = options.prover;

		const { success, data, error } = dcqlQuerySchema.safeParse(
			options.dcqlQuery,
		);

		if (!success) {
			throw new CircuitZkError(
				'invalid_request',
				`Invalid DCQL query: ${error.message}`,
			);
		}

		this.credentials = data.credentials.map((c) => {
			const cred = new CircuitZkCredentialQuery(c);

			try {
				assertAttestationPolicies(cred);
			} catch (err) {
				if (!(err instanceof AttestationPolicyViolation)) throw err;

				throw new CircuitZkError(
					'invalid_request',
					`Attestation policy violation for credential '${cred.id}': ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			return cred;
		});
	}

	async resolveRequestCircuits(): Promise<void> {
		const supportedProofSystems = await this.#prover.supportedProofSystems();

		await Promise.all(
			this.credentials.map(async (cred) => {
				const doctype = cred.meta.docTypeValue;
				if (!doctype) {
					throw new CircuitZkError(
						'invalid_request',
						'vct-based circuit_zk not supported',
					);
				}

				// verifier-accepted ∩ wallet-runnable; if the verifier didn't list any,
				// fall back to all wallet-runnable
				const acceptedSystems = this.supportedFormat?.circuitProofSystemValues
					? this.supportedFormat.circuitProofSystemValues.filter((s) =>
							supportedProofSystems.has(s),
						)
					: [...supportedProofSystems];

				const criteria: CircuitZkSelectionCriteria = {
					doctype,
					req: cred.functions.map((f) => f.serialize()),
					acceptedCircuitIds: this.supportedFormat?.circuitIdValues,
					acceptedSystems,
				};

				const selection = await this.#registry.selectCircuit(criteria);
				if (!selection) {
					throw new CircuitZkError(
						'invalid_request',
						`No approved circuit for credential '${cred.id}'`,
					);
				}

				cred.setResolved(selection);
			}),
		);
	}

	credentialCriteria(): CircuitZkCredentialCriteria[] {
		return this.credentials.map((cred) => ({
			credentialQueryId: cred.id,
			doctype: cred.meta.docTypeValue,
			vct: cred.meta.vctValues,
			sourceFormat: cred.meta.sourceFormat,
			requiredAttributes: attestationSourceAttributes(cred),
		}));
	}
}
