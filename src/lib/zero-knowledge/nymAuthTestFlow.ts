// nymAuthTestFlow.ts -- DEV ONLY. Runs the circuit_zk flow end to end against the Android wrapper with a
// fake nym_auth credential: parse request -> resolve circuit (native registry host) -> match credential ->
// prove (native prover host) -> vp_token. It mirrors the PR's example flow, with the native hosts.
//
import {
  ZkpReqNativeWrapperRegistryHost,
  ZkpReqRegistry,
  ZkpReqRequest,
  ZkpReqVpFormat,
  type IZkpReqProver,
  type ProofSystem,
} from '@sirosfoundation/zkp-req';
import { CircuitZkNativeWrapperProverHost } from './CircuitZkNativeWrapperProverHost';

import { derivePrivateSeed, NYM_AUTH_DOC_TYPE } from './nymAuthZk';
import { buildFakeNymAuthMdoc } from './nymAuthFixture';

/**
 * `ssc`: what the catalogue's circuits are built for. Selection succeeds; proving is expected to be refused,
 *        because the SDK does not prove configs whose seed the wallet does not hold.
 * `psc`: the config the wallet's own seed satisfies. Needs the debug wrapper (fake prover + test circuit)
 *        and a verifier that does not restrict proof systems.
 */
export type NymAuthTestVariant = 'ssc' | 'psc';

export interface NymAuthTestOptions {
  variant: NymAuthTestVariant;
  /** The credential to present, from createFakeNymAuthCredential(). */
  credential: FakeNymAuthCredential;
  /** The unlocked private-seed root. This flow zeroes each copy it receives. */
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
  onProgress?: (step: string) => void;
}

/** A generated test credential; never stored in the wallet. */
export interface FakeNymAuthCredential {
  /** base64url mdoc, the stored-credential `raw`. */
  raw: string;
  birthDate: string;
  /** True when its psc is not this wallet's, so the presenter must refuse it. */
  foreignPsc: boolean;
  /** First bytes of the psc the credential carries, hex. */
  pscPreview: string;
  entity: TestEntity;
}

/** The wallet entity the flow works with, standing in for ExtendedVcEntity. */
type TestEntity = {
  credentialId: string;
  parsedCredential: {
    metadata: { credential: { doctype: string } };
    signedClaims: Record<string, unknown>;
  };
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Builds a fake nym_auth credential. Its psc commits to this wallet's own seed, unless `foreignPsc` is set.
 * It is signed with the SDK's public demo key and only lives in memory.
 */
export async function createFakeNymAuthCredential(opts: {
  birthDate: string;
  foreignPsc?: boolean;
  getRootKey: (credentialId: number) => Promise<Uint8Array>;
}): Promise<FakeNymAuthCredential> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.birthDate)) throw new Error('birth date must be YYYY-MM-DD');
  const root = await opts.getRootKey(1);
  const seed = await derivePrivateSeed(root, NYM_AUTH_DOC_TYPE);
  root.fill(0);
  try {
    const raw = await buildFakeNymAuthMdoc({
      birthDate: opts.birthDate,
      privateSeed: seed,
      foreignPsc: opts.foreignPsc,
    });
    const psc = new Uint8Array(await crypto.subtle.digest('SHA-256', seed as BufferSource));
    return {
      raw,
      birthDate: opts.birthDate,
      foreignPsc: !!opts.foreignPsc,
      pscPreview: opts.foreignPsc ? '(not this wallet)' : hex(psc.slice(0, 6)),
      entity: {
        credentialId: 'cred-nym-test',
        parsedCredential: {
          metadata: { credential: { doctype: NYM_AUTH_DOC_TYPE } },
          // Claim names only; the matching step looks at which attributes exist. The mdoc itself holds all three.
          signedClaims: { birth_date: opts.birthDate, ssc: 'test', psc: 'test' },
        },
      },
    };
  } finally {
    seed.fill(0);
  }
}

export interface NymAuthTestResult {
  chosenCircuit: { circuitId: string; proofSystem: string; proofSystemVersion: string };
  vpToken: Record<string, unknown>;
}

const CLIENT_ID = 'x509_san_dns:rp.example.com';
const ORIGIN = 'https://rp.example.com';
const NONCE = 'n-0S6_WzA2Mj';

function requestFor(variant: NymAuthTestVariant) {
  const config = variant === 'ssc' ? 'known-offender-matching-ssc' : 'known-offender-matching-psc';
  return {
    nonce: NONCE,
    client_id: CLIENT_ID,
    expected_origins: [ORIGIN],
    client_metadata:
      variant === 'ssc'
        ? {
            vp_formats_supported: {
              zkp_req: {
                proof_system_values: ['longfellow-nymauth'],
                system_id_values: ['nymauth-longfellow-mdoc-v1'],
              },
            },
          }
        : {},
    dcql_query: {
      credentials: [
        {
          id: 'nym_attestation',
          format: 'zkp_req',
          meta: { source_format: 'mso_mdoc', doctype_value: NYM_AUTH_DOC_TYPE },
          require_cryptographic_holder_binding: true,
          _req: [
            {
              fn_id: 'pseudonym',
              return: 'nym',
              params: { config, ver: 1, prf: 'sha-256' },
            },
            {
              fn_id: 'age_check',
              return: 'age-range-123',
              params: { ge: '2008-10-10', le: '2013-10-09' },
            },
          ],
        },
      ],
    },
  };
}

/** The simulated verifier used by the wallet-flow test: who it claims to be, and what it asks for. */
export const TEST_VERIFIER = { clientId: CLIENT_ID, origin: ORIGIN, nonce: NONCE };

/** The DCQL query of the simulated request (the same one the direct native test uses). */
export function testDcqlQuery(variant: NymAuthTestVariant) {
  return requestFor(variant).dcql_query;
}

export async function runNymAuthTestFlow(opts: NymAuthTestOptions): Promise<NymAuthTestResult> {
  const request = requestFor(opts.variant);

  const { raw, entity } = opts.credential;

  // 1. Native prover host and registry host.
  const proverHost = new CircuitZkNativeWrapperProverHost({
    toStoredCredential: () => ({ id: 1, format: 'mso_mdoc', raw, batch_id: 1, instance_id: 0 }),
    getRootKey: opts.getRootKey,
    // The fake prover never asks for a device signature.
    getSigner: () => async () => {
      throw new Error('unexpected signature request');
    },
    allowFakeProver: true,
    onProgress: opts.onProgress,
  });
  await proverHost.initialize();
  const prover: IZkpReqProver = {
    supportedProofSystems: async () => proverHost.supportedProofSystems,
    supports: async (ps: ProofSystem) => proverHost.supportedProofSystems.has(ps),
    prove: (input) => proverHost.prove(input),
    dispose: () => proverHost.dispose?.() ?? Promise.resolve(),
  };
  const registryHost = new ZkpReqNativeWrapperRegistryHost();
  await registryHost.initialize();
  if (!(await registryHost.isAvailable())) {
    // Say why, instead of the registry's generic "No circuit registry host available".
    const nw = (globalThis as { nativeWrapper?: Record<string, unknown> }).nativeWrapper;
    let caps = 'not read';
    try {
      caps = JSON.stringify(await (nw?.zkpCapabilities as (p: unknown) => Promise<unknown>)?.({}));
    } catch (e) {
      caps = `failed: ${String((e as Error)?.message ?? e)}`;
    }
    await proverHost.dispose?.();
    throw new Error(
      `Native circuit registry unavailable. nativeWrapper: ${nw ? 'present' : 'missing'}, ` +
        `zkpCapabilities: ${typeof nw?.zkpCapabilities}, zkpSelectCircuit: ${typeof nw?.zkpSelectCircuit}, ` +
        `capabilities: ${caps}`,
    );
  }
  const registry = new ZkpReqRegistry([registryHost]);

  try {
    // 2. Parse the request and resolve the system through the native registry.
    opts.onProgress?.('resolving_circuit');
    const circuitZkRequest = new ZkpReqRequest({
      dcqlQuery: request.dcql_query,
      vpFormat: ZkpReqVpFormat.fromClientMetadata(request.client_metadata),
      registry,
      prover,
    });
    await circuitZkRequest.resolveRequestSystems();

    // 3. Match the credential (the app's CredentialMatchingService does this for real entities).
    const [criteria] = circuitZkRequest.credentialCriteria();
    const claims = entity.parsedCredential.signedClaims;
    const matches =
      criteria.doctype === entity.parsedCredential.metadata.credential.doctype &&
      criteria.requiredAttributes.every((a) => a in claims);
    if (!matches) {
      throw new Error(
        `no credential matches query '${criteria.credentialQueryId}'. ` +
          `criteria: ${JSON.stringify(criteria)}; credential doctype: ${entity.parsedCredential.metadata.credential.doctype}, ` +
          `claims: ${Object.keys(claims).join(',')}`,
      );
    }

    // 4. Prove each query and assemble the vp_token.
    const vpToken: Record<string, unknown> = {};
    let chosen: NymAuthTestResult['chosenCircuit'] | undefined;
    for (const cred of circuitZkRequest.credentials) {
      const selection = cred.selection();
      chosen = {
        circuitId: selection.systemId,
        proofSystem: selection.proofSystem,
        proofSystemVersion: selection.proofSystemVersion,
      };
      vpToken[cred.id] = await prover.prove({
        selection,
        functions: cred.functions.map((f) => f.serialize()),
        credential: entity,
        nonce: request.nonce,
        clientId: request.client_id,
        origin: request.expected_origins[0],
      });
    }
    return { chosenCircuit: chosen!, vpToken };
  } finally {
    await registry.dispose();
    await prover.dispose();
  }
}
