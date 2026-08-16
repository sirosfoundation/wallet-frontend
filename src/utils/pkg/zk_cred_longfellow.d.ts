/* tslint:disable */
/* eslint-disable */

/**
 * Versions of the mdoc_zk circuit interface.
 */
export enum CircuitVersion {
    V6 = 6,
    V7 = 7,
    V8 = 8,
}

/**
 * Zero-knowledge prover for mdoc credential presentations.
 */
export class MdocZkProver {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * Zero-knowledge verifier for mdoc credential presentations.
 */
export class MdocZkVerifier {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * Initialize the prover by loading a decompressed circuit file.
 *
 * @param {Uint8Array} circuit - The decompressed circuit file.
 * @param {CircuitVersion} circuit_version - The version of the mdoc_zk circuit interface.
 * @param {number} num_attributes - The number of attributes to be disclosed in the presentation.
 * @returns {MdocZkProver}
 */
export function initialize_prover(circuit: Uint8Array, circuit_version: CircuitVersion, num_attributes: number): MdocZkProver;

/**
 * Initialize a V8 verifier from a circuit binary.
 */
export function initialize_verifier(circuit: Uint8Array, circuit_version: CircuitVersion, num_attributes: number): MdocZkVerifier;

/**
 * Create a proof for a credential presentation.
 *
 * @param {MdocZkProver} prover - The prover returned from `initialize()`.
 * @param {Uint8Array} device_response - The mdoc's DeviceResponse, as CBOR data.
 * @param {string} namespace -  The namespace of the claims.
 * @param {string[]} requested_claims - The identifiers of the claims to be disclosed.
 * @param {Uint8Array} session_transcript - The `SessionTranscript`, as CBOR data.
 * @param {string} time - The current time. This must be in RFC 3339 format, in UTC, with no time zone offset.
 * @returns {Uint8Array} The serialized proof.
 */
export function prove(prover: MdocZkProver, device_response: Uint8Array, namespace: string, requested_claims: string[], session_transcript: Uint8Array, time: string): Uint8Array;

/**
 * Create a proof with PPID support (V8 circuits).
 *
 * @param {MdocZkProver} prover - The prover returned from `initialize_prover()`.
 * @param {Uint8Array} device_response - The mdoc's DeviceResponse, as CBOR data.
 * @param {string} namespace - The namespace of the attributes to be disclosed.
 * @param {string[]} requested_claims - The identifiers of the attributes to disclose.
 * @param {Uint8Array} session_transcript - The session transcript binding the presentation.
 * @param {string} time - The current time in RFC 3339 format (e.g. "2026-03-05T22:39:45Z").
 * @param {Uint8Array} verifier_context - 32-byte verifier context for PPID derivation.
 * @returns {Uint8Array} The serialized proof.
 */
export function prove_with_ppid_wasm(prover: MdocZkProver, device_response: Uint8Array, namespace: string, requested_claims: string[], session_transcript: Uint8Array, time: string, verifier_context: Uint8Array): Uint8Array;

/**
 * Verify a V8 proof with PPID support.
 */
export function verify_with_ppid_wasm(verifier: MdocZkVerifier, issuer_public_key_sec1: Uint8Array, given_name_cbor: Uint8Array, ppid_cbor: Uint8Array, namespace: string, doc_type: string, session_transcript: Uint8Array, time: string, verifier_context: Uint8Array, proof: Uint8Array): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mdoczkprover_free: (a: number, b: number) => void;
    readonly __wbg_mdoczkverifier_free: (a: number, b: number) => void;
    readonly initialize_prover: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly initialize_verifier: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly prove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number, number];
    readonly prove_with_ppid_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number, number];
    readonly rust_verify_with_ppid: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => number;
    readonly verify_with_ppid_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
