// circuitZkPresentation.ts -- turns a `circuit_zk` DCQL query into a vp_token entry, using the PR's request and
// registry classes with the native hosts. Called from useOIDFlowSignHandler for queries whose format is
// `circuit_zk`; everything else still goes through the existing mdoc / sd-jwt code.
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

/**
 * The debug wrapper's prover is fake. Release builds of the wrapper have no prover configured at all, so they
 * cannot produce a fake token; and the prover host refuses a fake token unless this is true. It is true while
 * the real prover does not exist yet. Set it to false once a real prover ships.
 */
export const ALLOW_FAKE_ZK_PROVER = true;

type DcqlCredential = { id?: string; format?: string; meta?: { doctype_value?: string } };

/** The `circuit_zk` entry of a DCQL query with this id, if there is one. */
export function findCircuitZkQuery(dcqlQuery: unknown, credentialQueryId: string): DcqlCredential | undefined {
  const creds = (dcqlQuery as { credentials?: DcqlCredential[] } | undefined)?.credentials;
  return Array.isArray(creds) ? creds.find((c) => c?.id === credentialQueryId && c?.format === 'circuit_zk') : undefined;
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
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  /** Raw 64-byte r||s ES256 signature with the credential's device key. */
  signDevice: (credentialRaw: string, data: Uint8Array) => Promise<Uint8Array>;
  onProgress?: (step: string) => void;
}

export type CircuitZkDcqlCredential = DcqlCredential;

/**
 * Splits a DCQL query into its `circuit_zk` entries and everything else. The dcql library cannot parse
 * `circuit_zk`, so the two halves are matched by different code.
 *
 * `credential_sets` are dropped from the non-zk half when a request mixes both, because they may refer to
 * ids on the other side. Mixed requests are not a supported case yet.
 */
export function splitCircuitZkQuery(dcqlQuery: any): { zkQueries: any[]; otherQuery?: any } {
  const all: any[] = Array.isArray(dcqlQuery?.credentials) ? dcqlQuery.credentials : [];
  const zkQueries = all.filter((c) => c?.format === 'circuit_zk');
  if (zkQueries.length === 0) return { zkQueries, otherQuery: dcqlQuery };
  const others = all.filter((c) => c?.format !== 'circuit_zk');
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

/** What the verifier asks for (doctype, attributes) per `circuit_zk` query, for matching against stored credentials. */
export async function getCircuitZkCriteria(
  zkQueries: unknown[],
  clientMetadata?: Record<string, unknown>,
): Promise<CircuitZkCredentialCriteria[]> {
  return withNativeRequest(
    {
      zkQueries,
      clientMetadata,
      proverOptions: {
        toStoredCredential: NO_STORED_CREDENTIAL,
        getRootKey: NO_STORED_CREDENTIAL,
        getSigner: NO_STORED_CREDENTIAL,
        allowFakeProver: ALLOW_FAKE_ZK_PROVER,
      },
    },
    async ({ request }) => request.credentialCriteria(),
  );
}

/** Proves one `circuit_zk` query and returns the token string for the vp_token. */
export async function createCircuitZkVpToken(i: CircuitZkPresentationInput): Promise<string> {
  const query = findCircuitZkQuery(i.dcqlQuery, i.credentialQueryId);
  if (!query) throw new Error(`circuit_zk: no circuit_zk query '${i.credentialQueryId}' in the request`);
  const docType = query.meta?.doctype_value;
  if (!docType) throw new Error('circuit_zk: the query has no meta.doctype_value');
  if (!i.origin && !i.responseUri) throw new Error('circuit_zk: need an origin or a response_uri');

  return withNativeRequest(
    {
      // Only this query: other queries of the request are handled by their own formats.
      zkQueries: [query],
      clientMetadata: i.clientMetadata,
      proverOptions: {
        toStoredCredential: () => ({ id: 1, format: 'mso_mdoc', raw: i.credentialRaw, batch_id: 1, instance_id: 0 }),
        getRootKey: i.getRootKey,
        getSigner: () => (data: Uint8Array) => i.signDevice(i.credentialRaw, data),
        allowFakeProver: ALLOW_FAKE_ZK_PROVER,
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