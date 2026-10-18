// nymAuthFixture.ts -- DEV ONLY. Builds a fake nym_auth mdoc for testing the wallet plumbing with the
// fake prover. Port of the SDK sample's NymAuthDemoIssuer (same layout: bare IssuerSigned with
// birth_date, ssc, psc; 16-byte randoms; digestIDs from 0; COSE_Sign1 ES256 with x5chain).
//
// NOT AN ISSUER. It signs with the SDK's published demo key, which anyone can use. Never import this
// from production code, never store its output as a real credential, never send it to a real verifier.

export const NYM_AUTH_DOC_TYPE = 'eu.europa.ec.eudi.nym_auth.1';

const DEMO_KEY_PKCS8 =
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg/BD3hi8XFHKZOfrzJt1pEKUK8PObZ2hMptGeMHdOsRWhRANCAATSo8ReXz5Vgs5AJP+PDhhPx+WKtc+8Dk4TtrgwfqbjhQqkx361f617J9Ae6v+nzG15s96opIkDoi4rxD3HvOAd';
const DEMO_CERT_DER =
  'MIIByTCCAW+gAwIBAgIUa8LLf/PY/DM76o0ksvITEUxd7I4wCgYIKoZIzj0EAwIwOjE4MDYGA1UEAwwvU0lST1MgbnltX2F1dGggZGVtbyBpc3N1ZXIgKE5PVCBGT1IgUFJPRFVDVElPTikwHhcNMjYxMDEzMjIyMzEzWhcNMzYxMDEwMjIyMzEzWjA6MTgwNgYDVQQDDC9TSVJPUyBueW1fYXV0aCBkZW1vIGlzc3VlciAoTk9UIEZPUiBQUk9EVUNUSU9OKTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABNKjxF5fPlWCzkAk/48OGE/H5Yq1z7wOThO2uDB+puOFCqTHfrV/rXsn0B7q/6fMbXmz3qikiQOiLivEPce84B2jUzBRMB0GA1UdDgQWBBSTR50pC2S3SkRC8J2NFGH5yWDEyjAfBgNVHSMEGDAWgBSTR50pC2S3SkRC8J2NFGH5yWDEyjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQCb5k9k5eScHBSdBZgei5/ia5O5gIYMzbTsKxVBjPCs7gIgMrvxOiTK63I5uF7jJaypxXiubng7e2VNjSnbU1/anMg=';

// ---- minimal CBOR (definite lengths only, maps keep insertion order) ----
type Cbor =
  | number
  | string
  | Uint8Array
  | Cbor[]
  | { map: [Cbor, Cbor][] }
  | { tag: number; value: Cbor };

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function head(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function enc(v: Cbor): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); return cat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (Array.isArray(v)) return cat(head(4, v.length), ...v.map(enc));
  if ('tag' in v) return cat(head(6, v.tag), enc(v.value));
  return cat(head(5, v.map.length), ...v.map.flatMap(([k, x]) => [enc(k), enc(x)]));
}

const map = (...e: [Cbor, Cbor][]): Cbor => ({ map: e });
const tag = (t: number, value: Cbor): Cbor => ({ tag: t, value });

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
const tdate = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface FixtureInput {
  /** ISO full-date, e.g. `2000-01-31`. */
  birthDate: string;
  /** 16-byte private seed of THIS wallet for the docType (from derivePrivateSeed). psc = SHA-256(seed). */
  privateSeed: Uint8Array;
  /** The credential's device public key (P-256, 32-byte x and y). Random when omitted. */
  devicePublicKey?: { x: Uint8Array; y: Uint8Array };
  /** Put a psc that is not this wallet's, to see the presenter refuse the seed. */
  foreignPsc?: boolean;
}

/** Returns the base64url `raw` for a stored credential. */
export async function buildFakeNymAuthMdoc(input: FixtureInput): Promise<string> {
  const ssc = rand(32);
  const psc = input.foreignPsc ? rand(32) : await sha256(input.privateSeed);
  const device = input.devicePublicKey ?? { x: rand(32), y: rand(32) };

  const elements: [string, Cbor][] = [
    ['birth_date', tag(1004, input.birthDate)],
    ['ssc', ssc],
    ['psc', psc],
  ];

  const items: Cbor[] = [];
  const digests: [Cbor, Cbor][] = [];
  for (let i = 0; i < elements.length; i++) {
    const [name, value] = elements[i];
    const item = map(['digestID', i], ['random', rand(16)], ['elementIdentifier', name], ['elementValue', value]);
    const tagged = tag(24, enc(item));
    items.push(tagged);
    digests.push([i, await sha256(enc(tagged))]);
  }

  const now = new Date();
  const coseKey = map([1, 2], [-1, 1], [-2, device.x], [-3, device.y]);
  const mso = map(
    ['version', '1.0'],
    ['digestAlgorithm', 'SHA-256'],
    ['valueDigests', map([NYM_AUTH_DOC_TYPE, { map: digests }])],
    ['deviceKeyInfo', map(['deviceKey', coseKey])],
    ['docType', NYM_AUTH_DOC_TYPE],
    [
      'validityInfo',
      map(
        ['signed', tag(0, tdate(now))],
        ['validFrom', tag(0, tdate(now))],
        ['validUntil', tag(0, tdate(new Date(now.getTime() + 365 * 24 * 3600 * 1000)))],
      ),
    ],
  );
  const payload = enc(tag(24, enc(mso)));

  const protectedHeader = enc(map([1, -7]));
  const sigStructure = enc(['Signature1', protectedHeader, new Uint8Array(0), payload]);
  const key = await crypto.subtle.importKey(
    'pkcs8', b64(DEMO_KEY_PKCS8) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  // Web Crypto returns raw r||s, which is what COSE wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, sigStructure as BufferSource),
  );
  const issuerAuth = [protectedHeader, map([33, b64(DEMO_CERT_DER)]), payload, signature];

  const issuerSigned = map(['nameSpaces', map([NYM_AUTH_DOC_TYPE, items])], ['issuerAuth', issuerAuth]);
  return b64u(enc(issuerSigned));
}

/** The stored-credential object the bridge decodes, around a fake mdoc. */
export function fakeStoredCredential(raw: string, id = 1) {
  return { id, format: 'mso_mdoc', raw, batch_id: 1, instance_id: 0 };
}