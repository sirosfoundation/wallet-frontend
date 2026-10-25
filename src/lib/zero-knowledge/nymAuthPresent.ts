// nymAuthPresent.ts -- proves one nym_auth zero-knowledge query (rulebook v0.4 `zkp_req`) of an OpenID4VP request with
// the Android wrapper's native prover, over a credential stored in the wallet. Returns the vp_token entry for that query.
//
// Accepts the v0.4 shape (format zkp_req, `_req` on the query, items {fn_id, return, params}) and the earlier
// circuit_zk shape (claims._req, items {fn_id, id, params}).
//
// The credential's secret seed is the one the issuer delivered with it, stored at issuance (nymAuthSeedStore); a
// credential without one is refused.
//
// Two inputs are not yet delivered to this code by the rest of the wallet. Until they are, dev stand-ins are
// supplied (and logged) by default; a build with VITE_NYMAUTH_DEV=false refuses instead:
//   - the query's `_req` (the wallet-backend drops it when relaying the request);
//   - the request's client_metadata offer (the sign handler does not receive it).
import { NymAuthZkProver, type ZkTranscript } from './nymAuthZk';

export const ZK_FORMATS = new Set(['zkp_req', 'circuit_zk']);

/** Dev stand-ins for the inputs above. Never enable in a build anyone else uses. */
// ON by default until the wallet receives `_req` and the offer; a build with
// VITE_NYMAUTH_DEV=false turns it off. Written exactly as `import.meta.env.VITE_…` so Vite replaces it at build time.
const NYMAUTH_DEV: boolean = import.meta.env.VITE_NYMAUTH_DEV !== 'false';
if (NYMAUTH_DEV) console.warn('[nym-proof] dev stand-ins are ON (set VITE_NYMAUTH_DEV=false to turn them off)');

const DEV = {
  /** The verifier offer assumed when client_metadata does not arrive (what the nym_auth verifier publishes). */
  systemIdValues: ['urn:circuits:longfellow:nym_auth:v1'],
  proofSystemValues: ['longfellow-libzk-v1'],
  /** The functions proven when the relayed query lost `_req`. */
  req: [{ fn_id: 'pseudonym', return: 'nym', params: { config: 'known-offender-matching-ssc', ver: 1, prf: 'sha-256' } }],
};

// The SDK's function handler ids (siros-sdk-kotlin v0.21.0, rulebook v0.4): the request's own fn_id. The old
// circuit_zk id 'pseudonym-v1-sha256' is accepted from a request and mapped to the v0.4 one.
const FUNCTION_IDS: Record<string, string> = {
  pseudonym: 'pseudonym',
  'pseudonym-v1-sha256': 'pseudonym',
  age_check: 'age_check',
};

/** Request keys that are not function parameters; v0.4's config, ver and prf pass through as the request states them. */
const REQUEST_ONLY_PARAMS = new Set(['source']);

const SECRET_SEED_BYTES = 16;


export function isZkQuery(query: { format?: string } | undefined): boolean {
  return !!query && ZK_FORMATS.has(String(query.format));
}

type RequestFunction = { fn_id?: string; function_id?: string; id?: string; return?: string; handle?: string; params?: Record<string, unknown> };

/** The query's functions as the native plan wants them: SDK function ids, handles, function parameters only. */
function planFunctionsOf(query: Record<string, any>) {
  let items: RequestFunction[] = query._req ?? query.req ?? query.claims?._req ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    if (!NYMAUTH_DEV) throw new Error(`zk query '${query.id}' names no functions (_req is missing)`);
    items = DEV.req;
  }
  return items.map((f) => {
    const fn = f.fn_id ?? f.function_id;
    const id = fn ? FUNCTION_IDS[fn] : undefined;
    if (!id) throw new Error(`zk query '${query.id}': unsupported function ${fn}`);
    const handle = f.return ?? f.handle ?? f.id;
    if (!handle) throw new Error(`zk query '${query.id}': function ${fn} has no return/handle`);
    const params = Object.fromEntries(Object.entries(f.params ?? {}).filter(([k]) => !REQUEST_ONLY_PARAMS.has(k)));
    return { id, handle, params };
  });
}

/**
 * The request's offer (`zkp_req` system_id_values / proof_system_values). The SDK answers only with a system the
 * request offered, and picks the circuit from it.
 */
function offerOf(clientMetadata: Record<string, any> | undefined): { systemIdValues: string[]; proofSystemValues: string[] } {
  const formats = clientMetadata?.vp_formats_supported ?? clientMetadata?.vp_formats ?? {};
  const zkp = formats.zkp_req ?? {};
  if (Array.isArray(zkp.system_id_values) || Array.isArray(zkp.proof_system_values)) {
    return {
      systemIdValues: Array.isArray(zkp.system_id_values) ? zkp.system_id_values : [],
      proofSystemValues: Array.isArray(zkp.proof_system_values) ? zkp.proof_system_values : [],
    };
  }
  if (!NYMAUTH_DEV) throw new Error('the request states no zkp_req offer (client_metadata.vp_formats_supported.zkp_req)');
  return { systemIdValues: DEV.systemIdValues, proofSystemValues: DEV.proofSystemValues };
}

/** The credential's issuer-delivered secret seed, stored at issuance (nymAuthSeedStore). */
function secretSeedOf(stored: Uint8Array | undefined): Uint8Array {
  if (!stored) throw new Error('this credential has no stored secret seed (issue it again with seed delivery)');
  if (stored.length !== SECRET_SEED_BYTES) throw new Error(`the stored secret seed is ${stored.length} bytes, not ${SECRET_SEED_BYTES}`);
  return stored.slice();
}

/** Raw r||s ES256 signer over a keystore device key (a private JWK). */
export function signerFromPrivateJwk(privateKey: { kty: string; crv: string; x: string; y: string; d: string }) {
  let key: CryptoKey | undefined;
  return async (data: Uint8Array): Promise<Uint8Array> => {
    key ??= await crypto.subtle.importKey(
      'jwk',
      { kty: privateKey.kty, crv: privateKey.crv, x: privateKey.x, y: privateKey.y, d: privateKey.d },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data as BufferSource));
  };
}

export interface NymAuthPresentInput {
  /** The DCQL credential query being answered. */
  query: Record<string, any>;
  /** The request's client_metadata (for the offer). */
  clientMetadata?: Record<string, any>;
  /** The stored credential: its base64url mdoc and ids. */
  credential: { raw: string; id?: number; batchId?: number; instanceId?: number };
  /** The credential's issuer-delivered 16-byte secret seed, when the wallet stored one. Not zeroed here. */
  secretSeed?: Uint8Array;
  /** Raw r||s ES256 signature with the credential's device key. */
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  /** The keystore's private-seed root (only asked for -psc configs). */
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  /** The verifier's client_id, exactly as in the request (prefix included). */
  clientId: string;
  nonce: string;
  /** OpenID4VP redirect / direct_post: the response_uri. */
  responseUri?: string;
  /** DC API: the verified origin. */
  origin?: string;
  verifierJwkThumbprint?: string;
  onProgress?: (step: string) => void;
}

/** Proves one zk query; resolves with the base64url token for vp_token[query.id]. */
export async function proveNymAuthQuery(i: NymAuthPresentInput): Promise<string> {
  const docType = i.query.meta?.doctype_value;
  if (!docType) throw new Error(`zk query '${i.query.id}' has no meta.doctype_value`);

  const transcript: ZkTranscript = i.responseUri
    ? { kind: 'openid4vp', clientId: i.clientId, nonce: i.nonce, responseUri: i.responseUri, verifierJwkThumbprint: i.verifierJwkThumbprint }
    : { kind: 'dc_api', origin: i.origin ?? '', nonce: i.nonce };

  // Everything that can refuse before native is asked is checked first.
  const functions = planFunctionsOf(i.query);
  const offer = offerOf(i.clientMetadata);
  const secretSeed = secretSeedOf(i.secretSeed);
  try {
    const result = await new NymAuthZkProver().generate({
      credential: {
        id: i.credential.id ?? 1,
        format: 'mso_mdoc',
        raw: i.credential.raw,
        batch_id: i.credential.batchId ?? 1,
        instance_id: i.credential.instanceId ?? 0,
      },
      // Rulebook v0.4: meta carries the type value and the source_format (mso_mdoc for nym_auth), never vct_values.
      plan: { functions, meta: { doctype_value: docType, source_format: i.query.meta?.source_format ?? 'mso_mdoc' } },
      // The circuit is chosen by native from the offer.
      ...offer,
      // Rulebook v0.4: the pseudonym is derived for the client_id exactly as published, prefix and all.
      verifierId: i.clientId,
      transcript,
      secretSeed,
      signer: i.sign,
      getRootKey: i.getRootKey,
      onProgress: i.onProgress,
    });
    return result.token;
  } finally {
    secretSeed.fill(0);
  }
}