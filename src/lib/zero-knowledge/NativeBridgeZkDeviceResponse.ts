// NativeBridgeZkDeviceResponse.ts -- zero-knowledge presentations for the wallet, in one module.
//
// The wallet makes one call, the same for Longfellow, Vega or any system added
// later, and never names a proof system or a runtime:
//
//   const request = ZeroKnowledgeRequest.fromOpenId4Vp(dcql, { clientId, nonce, responseUri });
//   const { deviceResponse, queryId } = await createZkProofService()
//     .generateProof({ rawMdocB64u }, request, { signer: signWithDeviceKey });
//
// The DCQL comes from the verifier and is forwarded unchanged: its
// zk_system_type names the acceptable systems, and the prover (the native SDK,
// through ZkpBridge) picks one it can run. The wallet hard-codes no query, no
// system and no system rules; it only offers its device-key signer, which the
// systems that bind the proof to the device (Longfellow) use and the others
// (Vega) ignore.
//
// Types live in ./types.ts; everything that runs is here.
import type {
  IZKDeviceResponse,
  IZeroKnowledgeRequest,
  ZkCredential,
  ZkDcqlCredentialQuery,
  ZkDcqlQuery,
  ZkDeviceResponse,
  ZkProofOptions,
  ZkSessionTranscriptInput,
  ZkSystemSpec,
} from './types';

// =============================================================================
// The verifier's request
// =============================================================================

/** The DCQL credential-query format that asks for a zero-knowledge proof. */
export const MSO_MDOC_ZK_FORMAT = 'mso_mdoc_zk';

/** The derived claim a V8 Longfellow verifier asks for. */
export const PSEUDONYM_CLAIM = 'pairwise_pseudonym';

export class ZeroKnowledgeRequest implements IZeroKnowledgeRequest {
  constructor(
    readonly dcql: ZkDcqlQuery,
    readonly transcript: ZkSessionTranscriptInput,
    readonly verifierClientId: string,
  ) {}

  /** Builds the transcript input the same way the wallet's mdoc path does. */
  static fromOpenId4Vp(
    dcql: ZkDcqlQuery,
    v: { clientId: string; nonce: string; responseUri: string; verifierJwkThumbprint?: string | null },
  ): ZeroKnowledgeRequest {
    return new ZeroKnowledgeRequest(
      dcql,
      {
        kind: 'openid4vp',
        clientId: v.clientId,
        nonce: v.nonce,
        responseUri: v.responseUri,
        verifierJwkThumbprint: v.verifierJwkThumbprint ?? undefined,
      },
      v.clientId,
    );
  }

  static fromDcApi(
    dcql: ZkDcqlQuery,
    v: { origin: string; nonce: string; encryptionJwkThumbprint?: string | null },
  ): ZeroKnowledgeRequest {
    return new ZeroKnowledgeRequest(
      dcql,
      {
        kind: 'dc_api',
        origin: v.origin,
        nonce: v.nonce,
        encryptionJwkThumbprint: v.encryptionJwkThumbprint ?? undefined,
      },
      v.origin,
    );
  }

  /** The credential queries that ask for a zero-knowledge proof. */
  private zkQueries(): ZkDcqlCredentialQuery[] {
    return (this.dcql.credentials ?? []).filter((q) => q.format === MSO_MDOC_ZK_FORMAT);
  }

  private claimNames(q: ZkDcqlCredentialQuery): string[] {
    return (q.claims ?? [])
      .map((c) => c.path[c.path.length - 1])
      .filter((name): name is string => typeof name === 'string');
  }

  isZKPRequest(): boolean {
    return this.zkQueries().length > 0;
  }

  isPseudonym(): boolean {
    return this.zkQueries().some((q) => this.claimNames(q).includes(PSEUDONYM_CLAIM));
  }

  zkpSystems(): ZkSystemSpec[] {
    return this.zkQueries().flatMap((q) =>
      (q.meta?.zk_system_type ?? []).filter((s) => typeof s?.system === 'string'),
    );
  }

  requestedClaims(): string[] {
    return [...new Set(this.zkQueries().flatMap((q) => this.claimNames(q)))];
  }
}

// =============================================================================
// The Android wrapper's native prover (ZkpBridge, `__zkp__` channel)
// =============================================================================

/** What injectjs.js exposes on `window.nativeWrapper` for zero-knowledge proofs. */
interface NativeZkpBridge {
  zkpCapabilities(params: unknown): Promise<{ zkSystems: string[]; busy: boolean }>;
  zkpGenerate(params: unknown): Promise<{ proofId: string }>;
  zkpCancel(params: unknown): Promise<unknown>;
  onZkpRequest(name: string, handler: (payload: any) => unknown): () => void;
}

interface CompletePayload {
  proofId: string;
  success: boolean;
  deviceResponse?: string;
  system?: string;
  queryId?: string;
  disclosedClaims?: string[];
  error?: { code: string; message: string };
}

/** The first proof on a device also downloads circuits (tens of MB). */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const toB64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
};

const fromB64 = (v: string): Uint8Array => {
  const n = v.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(n.padEnd(n.length + ((4 - (n.length % 4)) % 4), '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export class NativeBridgeZkDeviceResponse implements IZKDeviceResponse {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  private bridge(): NativeZkpBridge | null {
    const w = (globalThis as { nativeWrapper?: Partial<NativeZkpBridge> }).nativeWrapper;
    return w && typeof w.zkpGenerate === 'function' && typeof w.onZkpRequest === 'function'
      ? (w as NativeZkpBridge)
      : null;
  }

  isAvailable(): boolean {
    return this.bridge() !== null;
  }

  async supportedSystems(): Promise<string[]> {
    const bridge = this.bridge();
    if (!bridge) return [];
    const caps = await bridge.zkpCapabilities({});
    return Array.isArray(caps?.zkSystems) ? caps.zkSystems : [];
  }

  async generateProof(
    credential: ZkCredential,
    request: IZeroKnowledgeRequest,
    options: ZkProofOptions = {},
  ): Promise<ZkDeviceResponse> {
    const bridge = this.bridge();
    if (!bridge) throw new Error('The native ZK bridge is not available (Android wrapper only)');
    if (!request.isZKPRequest()) throw new Error('The request does not ask for an mso_mdoc_zk proof');
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');

    const { signer, onProgress, signal } = options;
    let proofId: string | null = null;
    const early = new Map<string, CompletePayload>(); // a `complete` that overtakes the zkpGenerate reply
    let settle!: (r: CompletePayload) => void;
    const completed = new Promise<CompletePayload>((resolve) => { settle = resolve; });

    const unregister = [
      // The device key never leaves the page: native asks, the injected signer answers.
      bridge.onZkpRequest('sign', async (req: { proofId?: string; algorithm?: string; data?: string }) => {
        if (proofId !== null && req?.proofId !== proofId) throw new Error('signature requested for a proof this page did not start');
        if (req?.algorithm !== 'ES256') throw new Error(`unsupported signature algorithm ${req?.algorithm}`);
        if (!signer || typeof req.data !== 'string') throw new Error('this proof system needs a device signature, and no signer was given');
        onProgress?.('signing');
        return { signature: toB64(await signer(fromB64(req.data))) };
      }),
      bridge.onZkpRequest('step', (p: { proofId?: string; step?: string }) => {
        if (proofId === null || p?.proofId === proofId) onProgress?.(p?.step ?? 'unknown');
      }),
      bridge.onZkpRequest('complete', (p: CompletePayload) => {
        if (proofId === null) { early.set(p?.proofId, p); return; }
        if (p?.proofId === proofId) settle(p);
      }),
    ];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => { bridge.zkpCancel({}).catch(() => { /* best effort */ }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      ({ proofId } = await bridge.zkpGenerate({
        // Minimal SDK StoredCredential (snake_case field names)
        credential: { id: 1, format: 'mso_mdoc', raw: credential.rawMdocB64u, batch_id: 1, instance_id: 0 },
        dcqlQuery: request.dcql,
        transcript: request.transcript,
        verifier: { clientId: request.verifierClientId },
      }));
      onProgress?.('started');
      const overtaken = early.get(proofId);
      if (overtaken) settle(overtaken);

      const result = await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            onAbort();
            reject(new Error(`the native ZK proof did not finish within ${this.timeoutMs / 1000}s`));
          }, this.timeoutMs);
        }),
      ]);
      if (!result.success || !result.deviceResponse) {
        throw new Error(`native ZK proof failed (${result.error?.code ?? 'unknown'}): ${result.error?.message ?? 'no message'}`);
      }
      return {
        deviceResponse: fromB64(result.deviceResponse),
        system: result.system ?? 'unknown',
        queryId: result.queryId ?? '',
        disclosedClaims: result.disclosedClaims ?? [],
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      unregister.forEach((u) => u());
    }
  }
}

// =============================================================================
// The entry point: picks a system and a prover for the request
// =============================================================================

export class NoZkProverError extends Error {
  constructor(readonly requestedSystems: string[], readonly availableSystems: string[]) {
    super(
      `No available prover runs any of the requested proof systems [${requestedSystems.join(', ')}]; ` +
        `this device offers [${availableSystems.join(', ')}]`,
    );
    this.name = 'NoZkProverError';
  }
}

export class ZkProofService implements IZKDeviceResponse {
  /** @param provers In order of preference: the first that runs a requested system is used. */
  constructor(private readonly provers: IZKDeviceResponse[]) {}

  isAvailable(): boolean {
    return this.provers.some((p) => p.isAvailable());
  }

  async supportedSystems(): Promise<string[]> {
    const all = await Promise.all(this.provers.filter((p) => p.isAvailable()).map((p) => p.supportedSystems()));
    return [...new Set(all.flat())];
  }

  /**
   * Routes the verifier's request, unchanged, to the first available prover
   * that runs one of the systems it asks for. The prover decides which.
   */
  async generateProof(
    credential: ZkCredential,
    request: IZeroKnowledgeRequest,
    options?: ZkProofOptions,
  ): Promise<ZkDeviceResponse> {
    if (!request.isZKPRequest()) throw new Error('The request does not ask for an mso_mdoc_zk proof');

    const requested = [...new Set(request.zkpSystems().map((s) => s.system))];
    const offered: string[] = [];
    for (const prover of this.provers) {
      if (!prover.isAvailable()) continue;
      const systems = await prover.supportedSystems();
      offered.push(...systems);
      // A request with no zk_system_type leaves the choice to the prover.
      if (requested.length === 0 || requested.some((s) => systems.includes(s))) {
        return prover.generateProof(credential, request, options);
      }
    }
    throw new NoZkProverError(requested, [...new Set(offered)]);
  }
}

/**
 * The wallet's prover: every runtime this build supports, best first. Add a
 * browser fallback (e.g. a Vega WASM prover implementing IZKDeviceResponse)
 * to this list and nothing in the wallet changes.
 */
export function createZkProofService(extra: IZKDeviceResponse[] = []): ZkProofService {
  return new ZkProofService([new NativeBridgeZkDeviceResponse(), ...extra]);
}