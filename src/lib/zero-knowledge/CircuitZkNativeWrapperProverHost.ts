// CircuitZkNativeWrapperProverHost.ts -- proves circuit_zk requests through the Android wrapper.
//
// Plugs into the app's CircuitZkProver as one prover host. Registry selection happens in
// CircuitZkNativeWrapperRegistryHost; this host proves with the circuit that selection returned.
import { CircuitZkProverHostPriority, CircuitZkProverHosts } from '@sirosfoundation/circuit-zk';
import type { ICircuitZkProverHost, ProofSystem } from '@sirosfoundation/circuit-zk';
import { NymAuthZkProver, type ZkTranscript } from './nymAuthZk';

/** One serialized function of the request, as `serialize()` returns it. */
export interface SerializedCircuitZkFunction {
  fn_id?: string;
  function_id?: string;
  /** The output id: the handle the result is returned under. `handle` wins when both are present. */
  id?: string;
  handle?: string;
  params?: unknown;
}

/** What the flow passes to prove(). */
export interface NativeProveInput {
  selection: { circuitId: string; proofSystem?: string; [k: string]: unknown };
  functions: SerializedCircuitZkFunction[];
  /** The wallet's credential entity for this query (ExtendedVcEntity). */
  credential: unknown;
  nonce: string;
  clientId: string;
  origin?: string;
  /** Present for redirect/direct_post responses; absent for the DC API. */
  responseUri?: string;
  encryptionJwkThumbprint?: string;
  /** Overrides the doctype read from the credential's metadata. */
  docType?: string;
}

export interface CircuitZkNativeWrapperProverHostOptions {
  /** The wallet's stored mdoc for this entity, in the shape native decodes (`{id, format, raw, ...}`). */
  toStoredCredential: (credential: unknown) => {
    id: number;
    format: string;
    raw: string;
    batch_id?: number;
    instance_id?: number;
  };
  /** The unlocked private-seed root; this host zeroes each copy it receives. */
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  /** Raw 64-byte r||s ES256 signature with the credential's device key. */
  getSigner: (credential: unknown) => (data: Uint8Array) => Promise<Uint8Array>;
  /**
   * The debug wrapper's prover is fake and its token is not a valid proof. By default prove() refuses to
   * return such a token, so it cannot reach a verifier by accident. Only set this in dev builds.
   */
  allowFakeProver?: boolean;
  onProgress?: (step: string) => void;
}

const X509_SAN_DNS = 'x509_san_dns:';
const BRIDGE_WAIT_MS = 3000;

export class CircuitZkNativeWrapperProverHost implements ICircuitZkProverHost {
  readonly id = CircuitZkProverHosts.NATIVE_WRAPPER;
  readonly priority = CircuitZkProverHostPriority.NATIVE_WRAPPER;

  readonly #native = new NymAuthZkProver();
  #systems: ReadonlySet<ProofSystem> = new Set();

  constructor(private readonly options: CircuitZkNativeWrapperProverHostOptions) {}

  /** The proof systems native reports; filled by initialize(). */
  get supportedProofSystems(): ReadonlySet<ProofSystem> {
    return this.#systems;
  }

  async initialize(): Promise<void> {
    // The wrapper injects its bridge after the page starts.
    const deadline = Date.now() + BRIDGE_WAIT_MS;
    while (!this.#native.isAvailable() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.#systems = new Set((await this.#native.supportedSystems()) as ProofSystem[]);
  }

  async isAvailable(): Promise<boolean> {
    return this.#native.isAvailable() && this.#systems.size > 0;
  }

  /** Resolves with the vp_token entry (base64url CBOR presentation) for one query. */
  async prove(input: unknown): Promise<unknown> {
    const i = input as NativeProveInput;
    const docType = i.docType ?? docTypeOf(i.credential);
    if (!docType) throw new Error('circuit_zk: cannot tell the credential docType');

    const result = await this.#native.generate({
      credential: this.options.toStoredCredential(i.credential),
      plan: {
        functions: i.functions.map(toPlanFunction),
        meta: { doctype_value: docType },
      },
      circuitId: i.selection.circuitId,
      verifierId: verifierIdOf(i.clientId),
      transcript: transcriptOf(i),
      signer: this.options.getSigner(i.credential),
      getRootKey: this.options.getRootKey,
      onProgress: this.options.onProgress,
    });

    if (result.fakeProver && !this.options.allowFakeProver) {
      throw new Error('circuit_zk: the native prover is a test prover; refusing to produce a presentation');
    }
    return result.token;
  }

  async dispose(): Promise<void> {}
}

function toPlanFunction(f: SerializedCircuitZkFunction) {
  const id = f.fn_id ?? f.function_id;
  const handle = f.handle ?? f.id;
  if (!id) throw new Error('circuit_zk: a function has no fn_id/function_id');
  if (!handle) throw new Error(`circuit_zk: function ${id} has no handle`);
  const params = f.params ?? {};
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error(`circuit_zk: params of function ${id} must be an object`);
  }
  return { id, handle, params: params as Record<string, unknown> };
}

/** `x509_san_dns:rp.example.com` -> `rp.example.com`, which is what a x509_san_dns pseudonym is derived for. */
function verifierIdOf(clientId: string): string {
  return clientId.startsWith(X509_SAN_DNS) ? clientId.slice(X509_SAN_DNS.length) : clientId;
}

function transcriptOf(i: NativeProveInput): ZkTranscript {
  if (i.responseUri) {
    return { kind: 'openid4vp', clientId: i.clientId, nonce: i.nonce, responseUri: i.responseUri };
  }
  if (!i.origin) throw new Error('circuit_zk: need responseUri (OpenID4VP) or origin (DC API) for the transcript');
  return { kind: 'dc_api', origin: i.origin, nonce: i.nonce, encryptionJwkThumbprint: i.encryptionJwkThumbprint };
}

function docTypeOf(credential: unknown): string | undefined {
  const m = (credential as { parsedCredential?: { metadata?: { credential?: { doctype?: string } } } })
    ?.parsedCredential?.metadata?.credential;
  return m?.doctype;
}