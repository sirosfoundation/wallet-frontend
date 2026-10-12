// types.ts -- shared, runtime-free types for zero-knowledge presentations.
//
// Pulled out of `VegaMdocProverService.ts` so the main-thread client
// (`VegaProverClient.ts`) can import just the type shapes without pulling
// in the WASM bindings, CBOR parser, etc. -- none of that belongs in the
// main bundle, only in the worker that actually runs the service.
//
// Everything here is `import type`-safe: no values, so importing this file
// never adds code to a bundle.

// ---- Vega prover (worker) shapes ----

/** The private witness the Vega prover runs over. Never leaves the device. */
export interface VegaWitnessVector {
  /** The stored mdoc, CBOR-encoded, as hex. */
  mdoc: string;
  /** Element identifiers to disclose, e.g. `["age_over_18"]`. */
  disclose: string[];
  pseudonymSeed: Uint8Array;
  verifierContext: Uint8Array;
}

/** What the Vega prover returns. Field availability varies by prover build. */
export interface VegaProofResult {
  /** The proof as hex - prefer this; `proof` may be a view into WASM memory. */
  proofHex?: string;
  proof?: Uint8Array;
  /** The parameter set the prover actually used, e.g. `vega-mc-p256-v1-prover-key-r12`. */
  zkSystemId?: string;
  /** RFC 3339 without fractional seconds, e.g. `2026-10-05T10:00:00Z`. */
  timestamp?: string;
}

// ---- prover.worker.ts <-> VegaProverClient.ts message protocol ----
//
// Kept here (not in prover.worker.ts itself) so the main-thread client
// can import these WITHOUT pulling the worker's own implementation file
// (which needs the `WebWorker` lib, not `DOM`) into the main program's
// type-checking scope -- the two libs' conflicting global declarations
// (`self`, `postMessage`, etc.) don't compose in one `tsc` program.

export interface GenerateProofRequest {
  type: 'GENERATE_PROOF';
  requestId: string;
  payload: VegaWitnessVector;
}

export interface ProofSuccessResponse {
  type: 'PROOF_SUCCESS';
  requestId: string;
  payload: VegaProofResult;
}

export interface ProofErrorResponse {
  type: 'PROOF_ERROR';
  requestId: string;
  payload: string;
}

/** Everything the worker can send back. Discriminate on `type`. */
export type ProverWorkerResponse = ProofSuccessResponse | ProofErrorResponse;

// ---- Zero-knowledge presentation abstraction ----
//
// One request type and one prover interface, so the wallet does not care
// which proof system or which runtime (native bridge, WASM in a worker)
// produces the proof. The request comes from the verifier; the prover
// decides how to answer it.

/**
 * One `zk_system_type` entry from a verifier's DCQL query: a proof system
 * the verifier accepts, and the parameters it needs. Extra keys are
 * system-specific and kept flat, as verifiers send them - e.g. Longfellow's
 * `num_attributes`.
 */
export interface ZkSystemSpec {
  /** Proof system family, e.g. `longfellow-libzk-v1` or `vega-mc-p256-v1`. */
  system: string;
  /** The circuit or parameter set, e.g. `longfellow-libzk-v1_8_2_4307_2945`. */
  id?: string;
  [param: string]: unknown;
}

/**
 * A verifier's DCQL query, as far as a zero-knowledge prover reads it.
 *
 * Not the `dcql` library's `DcqlQuery.Input`: that type only knows the
 * formats in the OpenID4VP spec (`mso_mdoc`, `dc+sd-jwt`, ...), so it cannot
 * express an `mso_mdoc_zk` query, and its parser rejects one. Anything not
 * listed here passes through untouched to the prover.
 */
export interface ZkDcqlQuery {
  credentials: ZkDcqlCredentialQuery[];
  credential_sets?: unknown[];
  [extension: string]: unknown;
}

export interface ZkDcqlCredentialQuery {
  id: string;
  /** `mso_mdoc_zk` for a zero-knowledge request; other formats are ignored. */
  format: string;
  meta?: {
    doctype_value?: string;
    zk_system_type?: ZkSystemSpec[];
    /** Secondary binding context for a pairwise pseudonym, if the verifier supplies one. */
    ppid_context?: string;
    [key: string]: unknown;
  };
  claims?: Array<{ id?: string; path: Array<string | number | null>; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * What the SessionTranscript is built from - the same inputs as a normal
 * mdoc presentation, so a ZK proof is bound to the same verifier session.
 */
export type ZkSessionTranscriptInput =
  | {
      kind: 'openid4vp';
      clientId: string;
      nonce: string;
      responseUri: string;
      verifierJwkThumbprint?: string;
    }
  | {
      kind: 'dc_api';
      origin: string;
      nonce: string;
      encryptionJwkThumbprint?: string;
    };

/** A verifier's request, read for what a zero-knowledge prover needs. */
export interface IZeroKnowledgeRequest {
  /** The verifier's DCQL query, unchanged. Provers forward it as is. */
  readonly dcql: ZkDcqlQuery;
  /** The verifier session the proof is bound to. */
  readonly transcript: ZkSessionTranscriptInput;
  /** The verifier's client id - the identity a pairwise pseudonym is derived for. */
  readonly verifierClientId: string;

  /** Whether any credential query asks for `mso_mdoc_zk`. */
  isZKPRequest(): boolean;
  /** Whether a pairwise pseudonym is requested (derived, not a stored claim). */
  isPseudonym(): boolean;
  /**
   * The proof systems the verifier accepts, in its order of preference. A
   * verifier may offer several; the prover picks one it can run.
   */
  zkpSystems(): ZkSystemSpec[];
  /** The element identifiers to disclose, e.g. `["age_over_18"]`. */
  requestedClaims(): string[];
}

/** The stored credential a proof is made over. */
export interface ZkCredential {
  /** The stored mdoc, base64url (no padding) - the wallet's own encoding. */
  rawMdocB64u: string;
}

/**
 * Signs with the credential's device key when the proof system binds the
 * proof to it (Longfellow does; Vega does not). Returns a raw 64-byte
 * `r || s` ES256 signature - what WebCrypto's ECDSA produces - not DER.
 */
export type ZkDeviceSigner = (data: Uint8Array) => Promise<Uint8Array>;

/** Progress events, for UI. Names are the prover's own (`computing_proof`, `signing`, ...). */
export type ZkProgressListener = (step: string) => void;

/** A finished zero-knowledge presentation. */
export interface ZkDeviceResponse {
  /** The DeviceResponse carrying the proof, CBOR-encoded. Goes into `vp_token`. */
  deviceResponse: Uint8Array;
  /** The proof system that produced it, e.g. `longfellow-libzk-v1`. */
  system: string;
  /** The DCQL credential query id it answers - the `vp_token` key. */
  queryId: string;
  /** What the proof discloses, including `pairwise_pseudonym` when requested. */
  disclosedClaims: string[];
}

export interface ZkProofOptions {
  /** Required when the chosen system binds to the device key. */
  signer?: ZkDeviceSigner;
  onProgress?: ZkProgressListener;
  signal?: AbortSignal;
}

/**
 * Produces a zero-knowledge DeviceResponse for a request. Implemented once
 * per runtime - the Android wrapper's native bridge, the Vega WASM worker,
 * and so on - so callers stay the same whichever one is available.
 */
export interface IZKDeviceResponse {
  /** Whether this prover can run here (e.g. the native bridge is present). */
  isAvailable(): boolean;
  /** The proof systems this prover can run, e.g. `["longfellow-libzk-v1", "vega-mc-p256-v1"]`. */
  supportedSystems(): Promise<string[]>;
  generateProof(
    credential: ZkCredential,
    request: IZeroKnowledgeRequest,
    options?: ZkProofOptions,
  ): Promise<ZkDeviceResponse>;
}