// nymAuthZk.ts -- page side of nym_auth `circuit_zk` presentations through the native bridge.
//
// Native owns the circuit, the prover and the presenter. The page owns the credential, the device
// key (zkp.sign) and the root key (zkp.seed). The root key never leaves the page: native receives only
// the 16-byte private seed for one docType, per proof, and wipes it afterwards.

export const NYM_AUTH_DOC_TYPE = 'eu.europa.ec.eudi.nym_auth.1';

const PRIVATE_SEED_LABEL = 'org.siros.private_seed/v1';
const PRIVATE_SEED_BYTES = 16;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export type ZkTranscript =
  | { kind: 'openid4vp'; clientId: string; nonce: string; responseUri: string; verifierJwkThumbprint?: string }
  | { kind: 'dc_api'; origin: string; nonce: string; encryptionJwkThumbprint?: string }
  | { kind: 'raw'; sessionTranscript: string };

export interface CircuitZkPlanInput {
  functions: { id: string; handle: string; params?: Record<string, unknown> }[];
  meta: { doctype_value: string; [k: string]: unknown };
}

/** The wallet's stored credential, in the shape native's `StoredCredential` decodes. */
export interface StoredCredentialInput {
  id: number;
  format: string;
  raw: string;
  batch_id?: number;
  instance_id?: number;
  [k: string]: unknown;
}

export interface NymAuthProofInput {
  credential: StoredCredentialInput;
  plan: CircuitZkPlanInput;
  /** What the pseudonym is derived for (client id or origin). */
  verifierId: string;
  transcript: ZkTranscript;
  /** Base64 value for configs whose function takes one. */
  userValue?: string;
  /** The circuit the registry selected; native proves with this one. */
  circuitId?: string;
  /** Raw 64-byte r||s ES256 signature with the credential's device key. */
  signer: (data: Uint8Array) => Promise<Uint8Array>;
  /** Unlocked keystore root; throw if locked or declined. Reaches native as `seed_failed`. */
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  onProgress?: (step: string) => void;
  signal?: AbortSignal;
}

export interface NymAuthProof {
  /** Base64url token from native; goes into the vp_token. */
  token: string;
  /** True when the native prover is the SDK's fake one: the token is not a valid proof. */
  fakeProver: boolean;
}

interface NativeBridge {
  zkpCapabilities(p: unknown): Promise<{ zkSystems: string[]; busy: boolean; fakeProver: boolean }>;
  zkpGenerate(p: unknown): Promise<{ proofId: string }>;
  zkpCancel(p: unknown): Promise<unknown>;
  onRequest(name: string, handler: (payload: any) => unknown): () => void;
}

interface CompletePayload {
  proofId: string;
  success: boolean;
  token?: string;
  error?: { code: string; message: string };
}

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

function nativeBridge(): NativeBridge | null {
  const w = (globalThis as { nativeWrapper?: Partial<NativeBridge> }).nativeWrapper;
  return w && typeof w.zkpGenerate === 'function' && typeof w.onRequest === 'function' ? (w as NativeBridge) : null;
}

/** HKDF-SHA256(root, salt = empty, info = label + docType) -> 16 bytes. Matches the SDK keystore proposal. */
export async function derivePrivateSeed(
  rootKey: Uint8Array,
  docType: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', rootKey as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(PRIVATE_SEED_LABEL + docType),
    },
    key,
    PRIVATE_SEED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export class NymAuthZkProver {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  isAvailable(): boolean {
    return nativeBridge() !== null;
  }

  /** Systems native can prove, `[]` when ZK is not configured in this build. */
  async supportedSystems(): Promise<string[]> {
    const b = nativeBridge();
    if (!b) return [];
    const caps = await b.zkpCapabilities({});
    return Array.isArray(caps?.zkSystems) ? caps.zkSystems : [];
  }

  async generate(input: NymAuthProofInput): Promise<NymAuthProof> {
    const bridge = nativeBridge();
    if (!bridge) throw new Error('The native ZK bridge is not available (Android wrapper only)');
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('Aborted');
    const docType = input.plan.meta.doctype_value;
    if (!docType) throw new Error('plan.meta.doctype_value is required');

    const caps = await bridge.zkpCapabilities({});
    if (!caps?.zkSystems?.length) throw new Error('This build has no zero-knowledge prover configured');

    let proofId: string | null = null;
    const early = new Map<string, CompletePayload>();
    let settle!: (r: CompletePayload) => void;
    const completed = new Promise<CompletePayload>((resolve) => { settle = resolve; });
    const mine = (p?: { proofId?: string }) => proofId === null || p?.proofId === proofId;

    const unregister = [
      bridge.onRequest('zkp.sign', async (req: { proofId?: string; algorithm?: string; data?: string }) => {
        if (!mine(req)) throw new Error('signature requested for a proof this page did not start');
        if (req.algorithm !== 'ES256') throw new Error(`unsupported signature algorithm ${req.algorithm}`);
        if (typeof req.data !== 'string') throw new Error('zkp.sign: data is required');
        input.onProgress?.('signing');
        return { signature: toB64(await input.signer(fromB64(req.data))) };
      }),
      bridge.onRequest('zkp.seed', async (req: { proofId?: string; credentialId?: number; docType?: string }) => {
        if (!mine(req)) throw new Error('seed requested for a proof this page did not start');
        if (req.docType !== docType) throw new Error(`zkp.seed: unexpected docType ${req.docType}`);
        const root = await input.getRootKey(req.credentialId ?? input.credential.id);
        try {
          return { seed: toB64(await derivePrivateSeed(root, docType)) };
        } finally {
          root.fill(0);
        }
      }),
      bridge.onRequest('zkp.step', (p: { proofId?: string; step?: string }) => {
        if (mine(p)) input.onProgress?.(p?.step ?? 'unknown');
      }),
      bridge.onRequest('zkp.complete', (p: CompletePayload) => {
        if (proofId === null) { early.set(p?.proofId, p); return; }
        if (p?.proofId === proofId) settle(p);
      }),
    ];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => { bridge.zkpCancel({}).catch(() => {}); };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      ({ proofId } = await bridge.zkpGenerate({
        credential: input.credential,
        plan: input.plan,
        verifierId: input.verifierId,
        userValue: input.userValue,
        circuitId: input.circuitId,
        transcript: input.transcript,
      }));
      input.onProgress?.('started');
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
      if (!result.success || !result.token) {
        throw new Error(`native ZK proof failed (${result.error?.code ?? 'unknown'}): ${result.error?.message ?? 'no message'}`);
      }
      return { token: result.token, fakeProver: !!caps.fakeProver };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      unregister.forEach((u) => u());
    }
  }
}