// nymAuthSeedStore.ts -- keeps a nym_auth credential's issuer-delivered secret seed in the wallet state.
//
// The issuer delivers the 16-byte seed with the credential response, in
// credential_metadata["org.siros.secret_seed"]["org.siros.nym_auth"] (the credential's ssc is SHA-256(seed)). It is
// stored in the wallet state's settings, which are encrypted with the rest of the private data and synced through the
// backend like the credentials (so a credential issued in the browser can be presented from the app). One entry per
// credential instance, keyed by a hash of the stored credential, so presentation finds it from the credential alone.
//
// The seed never appears in a log: only whether one was found.

export const SECRET_SEED_METADATA = 'org.siros.secret_seed';
export const NYM_AUTH_NAMESPACE = 'org.siros.nym_auth';
const SETTING_PREFIX = 'org.siros.secret_seed.nym_auth.';
const SEED_BYTES = 16;

const toB64Url = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64 = (v: string): Uint8Array => {
  const n = v.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(n.padEnd(n.length + ((4 - (n.length % 4)) % 4), '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The seed as bytes, from hex or base64(url); undefined when it is not 16 bytes. */
function decodeSeed(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const bytes = /^[0-9a-fA-F]{32}$/.test(value)
      ? Uint8Array.from(value.match(/../g)!, (x) => parseInt(x, 16))
      : fromB64(value);
    return bytes.length === SEED_BYTES ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** The nym_auth secret seed a credential response delivered, or undefined. */
export function deliveredSeedOf(credentialMetadata: Record<string, unknown> | undefined): Uint8Array | undefined {
  const bySpace = credentialMetadata?.[SECRET_SEED_METADATA] as Record<string, unknown> | undefined;
  const value = bySpace?.[NYM_AUTH_NAMESPACE];
  // Tolerate { value: "..." } as well as a bare string.
  const seed = decodeSeed(typeof value === 'object' && value !== null ? (value as { value?: unknown }).value : value);
  if (bySpace && !seed) console.warn('[nym-seed] credential_metadata carries a secret_seed entry, but not a 16-byte nym_auth seed');
  return seed;
}

/** The settings key for one stored credential (its `data`, exactly as stored). */
async function settingKeyFor(credentialData: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialData)));
  return SETTING_PREFIX + toB64Url(digest.slice(0, 16));
}

/** The settings entries that store `seed` for each of these credential instances. */
export async function seedSettingsFor(credentialData: string[], seed: Uint8Array): Promise<Record<string, string>> {
  const value = toB64Url(seed);
  const entries: Record<string, string> = {};
  for (const data of credentialData) entries[await settingKeyFor(data)] = value;
  return entries;
}

/** The stored seed of this credential (its `data`, exactly as stored), or undefined. The caller zeroes it. */
export async function storedSeedOf(
  settings: Record<string, unknown> | null | undefined,
  credentialData: string,
): Promise<Uint8Array | undefined> {
  if (!settings) return undefined;
  return decodeSeed(settings[await settingKeyFor(credentialData)]);
}