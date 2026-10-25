// circuitZkPresentation.ts -- turns a zero-knowledge DCQL query into a vp_token entry with the native hosts.
// Called from useOIDFlowSignHandler for queries whose format is `circuit_zk` or `zkp_req`; everything else still
// goes through the existing mdoc / sd-jwt code.
//
// `circuit_zk` goes through the PR's request and registry classes. `zkp_req` (nym_auth rulebook v0.4: `_req` on the
// query, items {fn_id, return, params}) is not parsed by that library, so it is matched by its doctype and proved
// directly by nymAuthPresent.
import {
  CircuitZkNativeWrapperRegistryHost,
  CircuitZkRegistry,
  CircuitZkRequest,
  CircuitZkVpFormat,
  type CircuitZkCredentialCriteria,
  type ICircuitZkProver,
  type ProofSystem,
} from '@sirosfoundation/circuit-zk';
import { CircuitZkNativeWrapperProverHost } from './CircuitZkNativeWrapperProverHost';
import { proveNymAuthQuery } from './nymAuthPresent';

export const CIRCUIT_ZK_FORMAT = 'circuit_zk';
export const ZKP_REQ_FORMAT = 'zkp_req';

/** Whether a DCQL credential query is a zero-knowledge one this wallet proves natively. */
export function isZkFormat(format: unknown): boolean {
  return format === CIRCUIT_ZK_FORMAT || format === ZKP_REQ_FORMAT;
}

type DcqlCredential = { id?: string; format?: string; meta?: { doctype_value?: string }; [k: string]: unknown };

/** The zero-knowledge entry of a DCQL query with this id, if there is one. */
export function findCircuitZkQuery(dcqlQuery: unknown, credentialQueryId: string): DcqlCredential | undefined {
  const creds = (dcqlQuery as { credentials?: DcqlCredential[] } | undefined)?.credentials;
  return Array.isArray(creds) ? creds.find((c) => c?.id === credentialQueryId && isZkFormat(c?.format)) : undefined;
}

export interface CircuitZkPresentationInput {
  dcqlQuery: unknown;
  credentialQueryId: string;
  /** The stored mdoc as the wallet holds it (base64url IssuerSigned or DeviceResponse envelope). */
  credentialRaw: string;
  nonce: string;
  /** The verifier's client_id, e.g. `x509_san_dns:rp.example.com`. */
  clientId: string;
  /** Set for the DC API. */
  origin?: string;
  /** Set for redirect/direct_post. */
  responseUri?: string;
  /** The request's client_metadata, when known; decides which circuits the verifier accepts. */
  clientMetadata?: Record<string, unknown>;
  /** The verifier's response-encryption JWK thumbprint, when the response is encrypted; part of the transcript. */
  verifierJwkThumbprint?: string;
  /** The credential's stored nym_auth secret seed (16 bytes), for `-ssc` configs. The caller owns and zeroes it. */
  secretSeed?: Uint8Array;
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  /** Raw 64-byte r||s ES256 signature with the credential's device key. */
  signDevice: (credentialRaw: string, data: Uint8Array) => Promise<Uint8Array>;
  onProgress?: (step: string) => void;
}

export type CircuitZkDcqlCredential = DcqlCredential;

/**
 * Splits a DCQL query into its zero-knowledge entries (`circuit_zk`, `zkp_req`) and everything else. The dcql
 * library cannot parse either, so the two halves are matched by different code.
 *
 * `credential_sets` are dropped from the non-zk half when a request mixes both, because they may refer to
 * ids on the other side. Mixed requests are not a supported case yet.
 */
export function splitCircuitZkQuery(dcqlQuery: any): { zkQueries: any[]; otherQuery?: any } {
  const all: any[] = Array.isArray(dcqlQuery?.credentials) ? dcqlQuery.credentials : [];
  const zkQueries = all.filter((c) => isZkFormat(c?.format));
  if (zkQueries.length === 0) return { zkQueries, otherQuery: dcqlQuery };
  const others = all.filter((c) => !isZkFormat(c?.format));
  if (others.length === 0) return { zkQueries };
  const { credential_sets: _dropped, ...rest } = dcqlQuery;
  return { zkQueries, otherQuery: { ...rest, credentials: others } };
}

interface NativeRequestInput {
  zkQueries: unknown[];
  clientMetadata?: Record<string, unknown>;
  proverOptions: ConstructorParameters<typeof CircuitZkNativeWrapperProverHost>[0];
}

/** Sets up the native hosts, resolves the circuits for these queries, runs `fn`, and tears everything down. */
async function withNativeRequest<T>(
  i: NativeRequestInput,
  fn: (ctx: { request: CircuitZkRequest; prover: ICircuitZkProver }) => Promise<T>,
): Promise<T> {
  const proverHost = new CircuitZkNativeWrapperProverHost(i.proverOptions);
  await proverHost.initialize();
  const prover: ICircuitZkProver = {
    supportedProofSystems: async () => proverHost.supportedProofSystems,
    supports: async (ps: ProofSystem) => proverHost.supportedProofSystems.has(ps),
    prove: (input) => proverHost.prove(input),
    dispose: () => proverHost.dispose?.() ?? Promise.resolve(),
  };

  const registryHost = new CircuitZkNativeWrapperRegistryHost();
  await registryHost.initialize();
  if (!(await registryHost.isAvailable())) {
    await prover.dispose();
    throw new Error('circuit_zk: this build has no zero-knowledge prover (native circuit registry unavailable)');
  }
  const registry = new CircuitZkRegistry([registryHost]);

  try {
    const request = new CircuitZkRequest({
      dcqlQuery: { credentials: i.zkQueries } as never,
      vpFormat: CircuitZkVpFormat.fromClientMetadata((i.clientMetadata ?? {}) as never),
      registry,
      prover,
    });
    await request.resolveRequestCircuits();
    return await fn({ request, prover });
  } finally {
    await registry.dispose();
    await prover.dispose();
  }
}

const NO_STORED_CREDENTIAL = () => {
  throw new Error('circuit_zk: no credential is needed to read the request');
};

/**
 * What a `zkp_req` query asks of a credential: its doctype. The proof reads its inputs (ssc, birth_date) from the
 * credential itself, so no attribute has to be listed for matching.
 */
function zkpReqCriteria(query: DcqlCredential): CircuitZkCredentialCriteria {
  const doctype = query.meta?.doctype_value;
  if (!doctype) throw new Error(`zkp_req: query '${query.id}' has no meta.doctype_value`);
  return { credentialQueryId: query.id, doctype, requiredAttributes: [] } as unknown as CircuitZkCredentialCriteria;
}

/** What the verifier asks for (doctype, attributes) per zero-knowledge query, for matching against stored credentials. */
export async function getCircuitZkCriteria(
  zkQueries: unknown[],
  clientMetadata?: Record<string, unknown>,
): Promise<CircuitZkCredentialCriteria[]> {
  const queries = zkQueries as DcqlCredential[];
  const zkpReq = queries.filter((q) => q?.format === ZKP_REQ_FORMAT);
  const circuitZk = queries.filter((q) => q?.format === CIRCUIT_ZK_FORMAT);

  const criteria: CircuitZkCredentialCriteria[] = zkpReq.map(zkpReqCriteria);
  if (circuitZk.length > 0) {
    criteria.push(
      ...(await withNativeRequest(
        {
          zkQueries: circuitZk,
          clientMetadata,
          proverOptions: {
            toStoredCredential: NO_STORED_CREDENTIAL,
            getRootKey: NO_STORED_CREDENTIAL,
            getSigner: NO_STORED_CREDENTIAL,
          },
        },
        async ({ request }) => request.credentialCriteria(),
      )),
    );
  }
  return criteria;
}

/** Proves one zero-knowledge query and returns the token string for the vp_token. */
export async function createCircuitZkVpToken(i: CircuitZkPresentationInput): Promise<string> {
  const query = findCircuitZkQuery(i.dcqlQuery, i.credentialQueryId);
  if (!query) throw new Error(`circuit_zk: no zero-knowledge query '${i.credentialQueryId}' in the request`);
  const docType = query.meta?.doctype_value;
  if (!docType) throw new Error('circuit_zk: the query has no meta.doctype_value');
  if (!i.origin && !i.responseUri) throw new Error('circuit_zk: need an origin or a response_uri');

  if (query.format === ZKP_REQ_FORMAT) {
    i.onProgress?.('proving');
    return proveNymAuthQuery({
      query,
      clientMetadata: i.clientMetadata,
      credential: { raw: i.credentialRaw },
      secretSeed: i.secretSeed,
      sign: (data) => i.signDevice(i.credentialRaw, data),
      getRootKey: i.getRootKey,
      clientId: i.clientId,
      nonce: i.nonce,
      responseUri: i.responseUri,
      origin: i.origin,
      verifierJwkThumbprint: i.verifierJwkThumbprint,
      onProgress: i.onProgress,
    });
  }

  return withNativeRequest(
    {
      // Only this query: other queries of the request are handled by their own formats.
      zkQueries: [query],
      clientMetadata: i.clientMetadata,
      proverOptions: {
        toStoredCredential: () => ({ id: 1, format: 'mso_mdoc', raw: i.credentialRaw, batch_id: 1, instance_id: 0 }),
        getRootKey: i.getRootKey,
        getSigner: () => (data: Uint8Array) => i.signDevice(i.credentialRaw, data),
        onProgress: i.onProgress,
      },
    },
    async ({ request, prover }) => {
      i.onProgress?.('resolving_circuit');
      const cred = request.credentials.find((c) => c.id === i.credentialQueryId);
      if (!cred) throw new Error(`circuit_zk: no circuit could be chosen for '${i.credentialQueryId}'`);

      const token = await prover.prove({
        selection: cred.selection(),
        functions: cred.functions.map((f) => f.serialize()),
        // Only the doctype is read from this entity; the stored mdoc comes from toStoredCredential.
        credential: { parsedCredential: { metadata: { credential: { doctype: docType } } } },
        nonce: i.nonce,
        clientId: i.clientId,
        origin: i.origin,
        responseUri: i.responseUri,
        docType,
      } as never);
      return typeof token === 'string' ? token : JSON.stringify(token);
    },
  );
}