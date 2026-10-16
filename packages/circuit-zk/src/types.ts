import {
	CircuitZkHostPriority,
	CircuitZkRegistryHosts,
	CircuitZkProverHostPriority,
	CircuitZkProverHosts,
	SerializedReqFunction,
} from './resources';

// ============================================================
// Shared
// ============================================================

/**
 * A type representing a circuit ID.
 */
export type CircuitId = string;

/**
 * A type representing a proof system.
 */
export type ProofSystem = string;

/**
 * Represents a JSON value.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

// ============================================================
// Request
// ============================================================

/**
 * Represents a request for a nym_auth presentation according to it's rulebook.
 * Currently based on 0.3.
 *
 * @todo We will need further request data for the proof generation:
 * 			 - client_id
 * 			 - nonce
 * 			 - origin
 *       Investigate this as needed.
 *
 * @throws {CircuitZkError} If the request is invalid according to the rulebook.
 */
export interface ICircuitZkRequest {
	/**
	 * The verifier's supported presentation format, from
	 * `client_metadata.vp_formats_supported.circuit_zk`.
	 *
	 * Optional: over the DC API the Verifier SHOULD list accepted circuits but
	 * is not required to. When absent, the wallet selects any approved circuit
	 * supporting every `req` item.
	 */
	readonly supportedFormat?: ICircuitZkVpFormat;
	/**
	 * The list of credential queries included in this request.
	 */
	readonly credentials: ICircuitZkCredentialQuery[];
	/**
	 * Resolve a circuit for every credential, honouring `supportedFormat` and
	 * the registry. Populates each credential's `circuitId()`/`proofSystem()`.
	 */
	resolveRequestCircuits(): Promise<void>;
	/**
	 * Returns the criteria for each credential in the request,
	 * which can be used to evaluate whether the credentials meet
	 * the request's requirements.
	 */
	credentialCriteria(): CircuitZkCredentialCriteria[];
}

/**
 * The `vp_formats_supported` entry for a circuit zero-knowledge proof
 * presentation format. This is what the verifier supports; the wallet
 * must evaluate if it can meet the requirements specified by the verifier.
 * If no approved circuit matches, the request is unsatisfiable.
 *
 * Validation should happened before or during instantiation.
 * @throws {CircuitZkError} If the VP format is invalid according to the rulebook.
 */
export interface ICircuitZkVpFormat {
	/**
	 * Supported circuit proof system values. OPTIONAL; non-empty when present.
	 */
	readonly circuitProofSystemValues?: string[];
	/**
	 * Supported circuit ID values. OPTIONAL; non-empty when present.
	 */
	readonly circuitIdValues?: string[];
}

/**
 * A representation of a circuit zero-knowledge credential entry in the
 * DCQL query.
 */
export interface ICircuitZkCredentialQuery {
	/**
	 * The credential query id; keys this credential's entry in the vp_token.
	 */
	readonly id: string;
	/**
	 * The format of the credential query. It MUST be `'circuit_zk'`.
	 */
	readonly format: 'circuit_zk';
	/**
	 * Metadata associated with the credential query.
	 */
	readonly meta: ICircuitZkCredentialQueryMeta;
	/**
	 * Holder binding. MUST be absent or `true`; `false` is unsatisfiable.
	 */
	readonly requireCryptographicHolderBinding?: true;
	/**
	 * The requested items for this credential query. MUST be non-empty.
	 */
	readonly functions: ICircuitZkReqFunction[];
	/**
	 * Set the resolved circuit ID and proof system for this credential query.
	 * This is called after determining the appropriate circuit.
	 */
	setResolved(selection: CircuitZkSelection): void;
	/**
	 * The resolved circuit; available only after resolveRequestCircuits().
	 */
	selection(): CircuitZkSelection;
}

/**
 * `meta` MUST contain exactly one of `doctype_value` or `vct_values`.
 */
export interface ICircuitZkCredentialQueryMeta {
	/**
	 * ISO/IEC 18013-5 docType of the underlying attestation.
	 */
	readonly docTypeValue?: string;
	/**
	 * Reserved for a future SD-JWT VC binding; unused for now.
	 */
	readonly vctValues?: string[];
	/**
	 * Non-normative; appears only in the rulebook's WIP example.
	 */
	readonly sourceFormat?: string;
}

/**
 * A requested function to be run as part of proof generation.
 * A property of the circuit.
 * All requested functions must be satisfied for the request to be
 * considered actionable.
 */
export interface ICircuitZkReqFunction {
	/**
	 * The function type identifier, e.g. `pseudonym-v1-sha256` or `age_check`.
	 */
	readonly fnId: string;
	/**
	 * The output ID; keys this function's result in the response.
	 */
	readonly id: string;
	/**
	 * Parameters for this function; keys and values are defined by the
	 * registered function definition.
	 */
	readonly params?: JsonValue;
	/**
	 * Serializes this requested function into
	 * plain object suitable for transmission or storage.
	 */
	serialize(): SerializedReqFunction;
}

/**
 * Criteria for selecting a circuit zero-knowledge credential
 * based on the DCQL query and required attributes.
 */
export type CircuitZkCredentialCriteria = {
	/**
	 * which DCQL credential query this is for
	 */
	readonly credentialQueryId: string;
	/**
	 * match stored mdoc docType
	 */
	readonly doctype?: string;
	/**
	 * match stored vct values
	 */
	readonly vct?: string[];
	/**
	 * source credential format from meta, when present
	 */
	readonly sourceFormat?: string;
	/**
	 * source attributes the functions consume
	 */
	readonly requiredAttributes: string[];
};

// ============================================================
// Registry
// ============================================================

export type CircuitArtifactRef = {
	readonly url: string;
	readonly hash: string;
	readonly compression: 'zstd' | 'none';
}

export type CircuitZkSelection = {
	readonly circuitId: string;
	readonly proofSystem: string;
	readonly proofSystemVersion: string;
	readonly artifact?: CircuitArtifactRef;
};

export type CircuitZkSelectionCriteria = {
	readonly doctype: string;
	readonly req: SerializedReqFunction[];
	readonly acceptedCircuitIds?: string[];
	readonly acceptedSystems?: string[];
};

export interface ICircuitZkRegistry {
	selectCircuit(
		criteria: CircuitZkSelectionCriteria,
	): Promise<CircuitZkSelection | null>;
	dispose(): Promise<void>;
}

export interface ICircuitZkRegistryHost {
	readonly id: CircuitZkRegistryHosts;
	readonly priority: CircuitZkHostPriority;
	initialize(): Promise<void>;
	isAvailable(): Promise<boolean>;
	selectCircuit(
		criteria: CircuitZkSelectionCriteria,
	): Promise<CircuitZkSelection | null>;
	dispose?(): Promise<void>;
}

// ============================================================
// Prover
// ============================================================

export interface ICircuitZkProverHost {
	readonly id: CircuitZkProverHosts;
	readonly priority: CircuitZkProverHostPriority;
	readonly supportedProofSystems: ReadonlySet<ProofSystem>;
	initialize(): Promise<void>;
	isAvailable(): Promise<boolean>;
	/**
	 * @todo Define proof generation input/output.
	 */
	prove(request: unknown): Promise<unknown>;
	dispose?(): Promise<void>;
}

export interface ICircuitZkProver {
	/** All proof systems any available host can run (union across hosts). */
	supportedProofSystems(): Promise<ReadonlySet<ProofSystem>>;
	supports(proofSystem: ProofSystem): Promise<boolean>; // = (await supportedProofSystems()).has(ps)
	/**
	 * @todo Define proof generation input/output.
	 */
	prove(request: unknown): Promise<unknown>;
	dispose(): Promise<void>;
}

// ============================================================
// Presentation
// ============================================================

/**
 * Takes the {@link ICircuitZkRequest} and provides a interface
 * for the proof generation layer.
 */
export interface ICircuitZkPresentation {}
