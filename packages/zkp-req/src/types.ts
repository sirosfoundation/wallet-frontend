import {
	ZkpReqHostPriority,
	ZkpReqRegistryHosts,
	ZkpReqProverHostPriority,
	ZkpReqProverHosts,
	SerializedReqFunction,
} from './resources';

// ============================================================
// Shared
// ============================================================

/**
 * A type representing an approved system ID (a circuit or a scheme).
 */
export type SystemId = string;

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
 * Currently based on 0.4.
 *
 * @todo We will need further request data for the proof generation:
 * 			 - client_id
 * 			 - nonce
 * 			 - origin
 *       Investigate this as needed.
 *
 * @throws {ZkpReqError} If the request is invalid according to the rulebook.
 */
export interface IZkpReqRequest {
	/**
	 * The verifier's supported presentation format, from
	 * `client_metadata.vp_formats_supported.zkp_req`.
	 *
	 * Optional: over the DC API the Verifier SHOULD list accepted systems but
	 * is not required to. When absent, the wallet selects any approved system
	 * supporting every `_req` item.
	 */
	readonly supportedFormat?: IZkpReqVpFormat;
	/**
	 * The list of credential queries included in this request.
	 */
	readonly credentials: IZkpReqCredentialQuery[];
	/**
	 * Resolve a system for every credential, honouring `supportedFormat` and
	 * the registry. Populates each credential's `systemId()`/`proofSystem()`.
	 */
	resolveRequestSystems(): Promise<void>;
	/**
	 * Returns the criteria for each credential in the request,
	 * which can be used to evaluate whether the credentials meet
	 * the request's requirements.
	 */
	credentialCriteria(): ZkpReqCredentialCriteria[];
}

/**
 * The `vp_formats_supported` entry for the `zkp_req` presentation format.
 * This is what the verifier supports; the wallet must evaluate if it can
 * meet the requirements specified by the verifier.
 * If no approved system matches, the request is unsatisfiable.
 *
 * Validation should happened before or during instantiation.
 * @throws {ZkpReqError} If the VP format is invalid according to the rulebook.
 */
export interface IZkpReqVpFormat {
	/**
	 * Supported proof system values. OPTIONAL; non-empty when present.
	 */
	readonly proofSystemValues?: string[];
	/**
	 * Supported system ID values. OPTIONAL; non-empty when present.
	 */
	readonly systemIdValues?: string[];
}

/**
 * A representation of a `zkp_req` credential entry in the DCQL query.
 */
export interface IZkpReqCredentialQuery {
	/**
	 * The credential query id; keys this credential's entry in the vp_token.
	 */
	readonly id: string;
	/**
	 * The format of the credential query. It MUST be `'zkp_req'`.
	 */
	readonly format: 'zkp_req';
	/**
	 * Metadata associated with the credential query.
	 */
	readonly meta: IZkpReqCredentialQueryMeta;
	/**
	 * Holder binding. MUST be absent or `true`; `false` is unsatisfiable.
	 */
	readonly requireCryptographicHolderBinding?: true;
	/**
	 * The requested items for this credential query. MUST be non-empty.
	 */
	readonly functions: IZkpReqReqFunction[];
	/**
	 * Set the resolved system ID and proof system for this credential query.
	 * This is called after determining the appropriate system.
	 */
	setResolved(selection: ZkpReqSelection): void;
	/**
	 * The resolved system; available only after resolveRequestSystems().
	 */
	selection(): ZkpReqSelection;
}

/**
 * `meta` MUST contain `source_format` and exactly one of `doctype_value`,
 * `schema_id_value` or `vct_values`.
 */
export interface IZkpReqCredentialQueryMeta {
	/**
	 * The format of the attestation the proof is made over, e.g. `mso_mdoc` or `bbs_cd`.
	 */
	readonly sourceFormat: string;
	/**
	 * ISO/IEC 18013-5 docType of the underlying attestation (`mso_mdoc`).
	 */
	readonly docTypeValue?: string;
	/**
	 * bbs-cd-plugins schema identifier (`bbs_cd`).
	 */
	readonly schemaIdValue?: string;
	/**
	 * Reserved for a future SD-JWT VC binding; unused for now.
	 */
	readonly vctValues?: string[];
}

/**
 * A requested function to be run as part of proof generation.
 * All requested functions must be satisfied for the request to be
 * considered actionable.
 */
export interface IZkpReqReqFunction {
	/**
	 * The function type identifier, e.g. `pseudonym` or `age_check`.
	 */
	readonly fnId: string;
	/**
	 * The output handle; keys this function's result in the response.
	 */
	readonly return: string;
	/**
	 * Parameters for this function; keys and values are defined by the
	 * registered function definition.
	 */
	readonly params?: Record<string, JsonValue>;
	/**
	 * Serializes this requested function into
	 * plain object suitable for transmission or storage.
	 */
	serialize(): SerializedReqFunction;
}

/**
 * Criteria for selecting a `zkp_req` credential
 * based on the DCQL query and required attributes.
 */
export type ZkpReqCredentialCriteria = {
	/**
	 * which DCQL credential query this is for
	 */
	readonly credentialQueryId: string;
	/**
	 * match stored mdoc docType
	 */
	readonly doctype?: string;
	/**
	 * match stored bbs_cd schema identifier
	 */
	readonly schemaId?: string;
	/**
	 * match stored vct values
	 */
	readonly vct?: string[];
	/**
	 * source credential format from meta
	 */
	readonly sourceFormat: string;
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

export type ZkpReqSelection = {
	readonly systemId: SystemId;
	readonly proofSystem: string;
	readonly proofSystemVersion: string;
	/** Circuits only; a scheme (e.g. BBS) has no artifact. */
	readonly artifact?: CircuitArtifactRef;
};

export type ZkpReqSelectionCriteria = {
	readonly sourceFormat: string;
	/** The doctype (`mso_mdoc`) or schema identifier (`bbs_cd`). */
	readonly typeValue: string;
	readonly req: SerializedReqFunction[];
	readonly acceptedSystemIds?: string[];
	readonly acceptedSystems?: string[];
};

export interface IZkpReqRegistry {
	selectSystem(
		criteria: ZkpReqSelectionCriteria,
	): Promise<ZkpReqSelection | null>;
	dispose(): Promise<void>;
}

export interface IZkpReqRegistryHost {
	readonly id: ZkpReqRegistryHosts;
	readonly priority: ZkpReqHostPriority;
	initialize(): Promise<void>;
	isAvailable(): Promise<boolean>;
	selectSystem(
		criteria: ZkpReqSelectionCriteria,
	): Promise<ZkpReqSelection | null>;
	dispose?(): Promise<void>;
}

// ============================================================
// Prover
// ============================================================

export interface IZkpReqProverHost {
	readonly id: ZkpReqProverHosts;
	readonly priority: ZkpReqProverHostPriority;
	readonly supportedProofSystems: ReadonlySet<ProofSystem>;
	initialize(): Promise<void>;
	isAvailable(): Promise<boolean>;
	/**
	 * @todo Define proof generation input/output.
	 */
	prove(request: unknown): Promise<unknown>;
	dispose?(): Promise<void>;
}

export interface IZkpReqProver {
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
 * Takes the {@link IZkpReqRequest} and provides a interface
 * for the proof generation layer.
 */
export interface IZkpReqPresentation {}
