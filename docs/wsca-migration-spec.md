# Wallet-Frontend WSCA Migration Specification

Version: 0.3 (Draft)  
Date: 2026-08-27  
Status: Proposal — two open decisions, see §0

## 0. Open Decisions

Two questions must be answered before the `wallet-frontend` work in §13
Phase 2 can start. They are tracked in
[siros-wscd-manager#66](https://github.com/sirosfoundation/siros-wscd-manager/issues/66),
which also carries the current implementation status and a task graph.

### D1 — Where does the WASM module run?

This document and the architecture documentation currently specify
**different execution contexts**, and the difference is not cosmetic:

- **This document**: in-page. `wallet-frontend` takes the
  `@sirosfoundation/wscd-manager-wasm` dependency and calls `WscdManagerJs`
  from its own JavaScript.
- **`docs/docs/wallet/architecture/wsca-wscd.md`**: inside the
  `wallet-companion` browser extension's background service worker, which the
  page reaches over extension messaging.

The choice changes the security properties (see §10.1), the capability set,
the API shape (an extension boundary is async and serialised; an in-page call
is not), and who can use the feature at all — the extension model means no
hardware-backed keys for users who have not installed the companion.

**This must be resolved first.** Until it is, §2's architecture diagram
should be read as describing the in-page option only.

### D2 — Does the V3 → V4 blob split happen at all?

§5.2 already concludes that splitting the *backend API* buys nothing, because
credential data dominates the blob while the softkey container is a few
hundred bytes. §12.4 says the V3-compatible Phase 2 "can run indefinitely".

If D1 resolves to in-page, §10.1's isolation rationale does not apply (see
the correction there), and V4's remaining benefits are narrow: metadata-only
key events, plus a cross-platform key portability that §6.4 explicitly
declares a non-goal for state. Phase 3 is the most expensive and highest-risk
part of this plan — IndexedDB migration, event rewriting, cross-client
compatibility, and a normative `privatedata-spec` bump. It should be decided
deliberately rather than treated as implied by Phase 2.

## 1. Overview

This specification defines how to migrate `wallet-frontend` from its
monolithic private data blob (where key material and credential data are
co-mingled in a single JWE) to an architecture where:

1. **Key management** is handled by `siros-wscd-manager` compiled to WASM,
   providing the same `WscdPlugin` interface used by the native SDKs
   (Kotlin/Swift).
2. **Credential and wallet state** remain in an event-sourced encrypted
   container (the private data blob), but with key material removed.
3. The two concerns have **independent storage, encryption, and sync
   lifecycles**.

### 1.1 Goals

- Single source of truth for key management logic across all platforms
  (native + web) via the Rust `siros-wscd-manager` crate.
- Credential data and key material stored in separate encrypted containers
  with independent sync and conflict resolution.
- The softkey WASM module produces the **same container format** as the
  native SDKs, enabling cross-platform key portability.
- Existing PRF-derived encryption chain is preserved for both containers.
- Backwards-compatible migration from `WalletStateV3`.

### 1.2 Non-Goals

- Changes to the WebAuthn PRF or password-based key derivation chain itself.
- Changes to the JWE envelope format (`A256GCMKW` / `A256GCM`).

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  wallet-frontend                                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  KeystoreAdapter (TypeScript)                              │  │
│  │                                                            │  │
│  │  Protocol-level operations (unchanged signatures):         │  │
│  │  • generateOpenid4vciProofs()                              │  │
│  │  • signJwtPresentation()                                   │  │
│  │  • generateDeviceResponse()                                │  │
│  │  • generateDeviceResponseForDCAPI()                        │  │
│  │  • generateDeviceResponseWithProximity()                   │  │
│  │                                                            │  │
│  │  Delegates raw crypto to WscdManager (WASM).               │  │
│  │  Delegates credential lookup to WalletState (TS).          │  │
│  └────────────┬──────────────────────────────────┬────────────┘  │
│               │                                  │               │
│     generateKey / sign              credential lookup by kid     │
│     listKeys / deleteKey                                         │
│     exportPublicKey                                              │
│     securityProperties                                           │
│               │                                  │               │
│  ┌────────────▼──────────┐     ┌─────────────────▼────────────┐  │
│  │  siros-wscd-manager   │     │  WalletStateV4 Container     │  │
│  │  (WASM module)        │     │  (TypeScript, event-sourced) │  │
│  │                       │     │                              │  │
│  │  WscdManager          │     │  credentials[]               │  │
│  │   ├─ SoftkeyPlugin    │     │  presentations[]             │  │
│  │   │  (p256, ed25519)  │     │  settings                    │  │
│  │   ├─ R2PS Plugin      │     │                              │  │
│  │   │  (OPAQUE/FIDO2    │     │                              │  │
│  │   │   via JS callback)│     │                              │  │
│  │   └─ FIDO2 Plugin     │     │                              │  │
│  │      (rawSign via     │     │                              │  │
│  │       WebAuthn API)   │     │                              │  │
│  │                       │     │  credentialIssuanceSessions[] │  │
│  │  export_container()   │     │                              │  │
│  │  → cleartext JSON     │     │  NO keypairs[]               │  │
│  └────────────┬──────────┘     └──────────────────┬───────────┘  │
│               │                                   │              │
│  ┌────────────▼───────────────────────────────────▼───────────┐  │
│  │  Encryption Layer (TypeScript, existing code)              │  │
│  │                                                            │  │
│  │  PRF → HKDF → prfKey → ECDH → mainKey → JWE               │  │
│  │                                                            │  │
│  │  Produces TWO independent JWE containers:                  │  │
│  │    1. keyContainerJwe   (softkey JSON from WASM)           │  │
│  │    2. stateContainerJwe (WalletStateV4 JSON)               │  │
│  │                                                            │  │
│  │  Same mainKey encrypts both. Same PRF keys unlock it.      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                    ┌─────────▼─────────┐                         │
│                    │  Storage Layer    │                          │
│                    │                   │                          │
│                    │  IndexedDB:       │                          │
│                    │   store: keys     │                          │
│                    │   store: state    │                          │
│                    │                   │                          │
│                    │  Backend sync:    │                          │
│                    │   POST /private-data?type=keys               │
│                    │   POST /private-data?type=state              │
│                    └───────────────────┘                          │
└──────────────────────────────────────────────────────────────────┘
```

## 3. WASM Compilation of siros-wscd-manager

### 3.1 Feature Flags

A new Cargo feature `wasm` is added to `siros-wscd-manager/Cargo.toml`:

```toml
[features]
default = ["plugin-softkey"]
wasm = ["plugin-softkey", "getrandom/js", "web-time"]

[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.2", features = ["js"] }
web-time = "1"
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
js-sys = "0.3"
serde-wasm-bindgen = "0.6"
```

### 3.2 Conditional Compilation

The following items are gated behind `#[cfg(not(target_arch = "wasm32"))]`:

| Item | Reason |
|------|--------|
| `uniffi::setup_scaffolding!()` in `lib.rs` | UniFFI is native-only C FFI |
| Entire `ffi.rs` module | UniFFI bindings |
| `build.rs` UniFFI codegen | Build script |
| `tokio` features `rt`, `rt-multi-thread` | No thread runtime on WASM |
| `crate-type = ["cdylib", "staticlib"]` | WASM needs `cdylib` only |
| `josekit` / `openssl` dependencies | C library, not used by softkey |

The following items require platform-conditional implementations:

| Item | Native | WASM |
|------|--------|------|
| `std::time::SystemTime::now()` | As-is | Replace with `web_time::SystemTime` |
| `async_trait` bounds | `#[async_trait]` (requires `Send + Sync`) | `#[async_trait(?Send)]` |
| `OsRng` | Uses OS entropy | Uses `crypto.getRandomValues` via `getrandom/js` |

### 3.3 WASM Bindings

A new module `src/wasm.rs` (gated behind `#[cfg(target_arch = "wasm32")]`)
exposes the WASM API via `wasm-bindgen`:

```rust
#[wasm_bindgen]
pub struct WasmWscdManager { /* wraps WscdManager */ }

#[wasm_bindgen]
impl WasmWscdManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self;

    /// Initialize with a softkey plugin, optionally loading an existing
    /// container (cleartext JSON bytes from a decrypted JWE).
    pub fn register_softkey(&self, container: Option<Vec<u8>>) -> Result<(), JsValue>;

    /// Register the FIDO2 plugin with a JS callback for WebAuthn rawSign.
    /// The callback implements the Ctap2Transport trait by calling the
    /// WebAuthn API's `navigator.credentials.get()` with the `previewSign`
    /// extension.
    pub fn register_fido2(&self, transport: JsValue) -> Result<(), JsValue>;

    /// Register the R2PS plugin with HTTP transport and auth callbacks.
    /// `http_transport`: JS callback for fetch()-based HTTP requests.
    /// `auth_callback`: JS callback for OPAQUE PIN or WebAuthn assertion.
    pub fn register_r2ps(
        &self,
        config: JsValue,
        http_transport: JsValue,
        auth_callback: JsValue,
    ) -> Result<(), JsValue>;

    /// Generate a new key. Returns JSON: { kid, publicKeyJwk }.
    pub async fn generate_key(&self, algorithm: &str) -> Result<JsValue, JsValue>;

    /// Sign data. Returns the raw signature bytes.
    pub async fn sign(&self, kid: &str, data: &[u8], algorithm: &str)
        -> Result<Vec<u8>, JsValue>;

    /// List all keys. Returns JSON array of KeyInfo.
    pub fn list_keys(&self) -> Result<JsValue, JsValue>;

    /// Delete a key.
    pub async fn delete_key(&self, kid: &str) -> Result<(), JsValue>;

    /// Export a key's public JWK. Returns JSON.
    pub fn export_public_key(&self, kid: &str) -> Result<JsValue, JsValue>;

    /// Get security properties for a key. Returns JSON.
    pub fn security_properties(&self, kid: &str) -> Result<JsValue, JsValue>;

    /// Export the softkey container as cleartext JSON bytes.
    /// The caller MUST encrypt this (JWE) before persisting.
    pub fn export_container(&self) -> Result<Vec<u8>, JsValue>;
}
```

### 3.4 FIDO2 Plugin via WebAuthn rawSign

The FIDO2 `previewSign` (rawSign) extension is supported by YubiKey
firmware ≥ 5.8. In the browser, the plugin delegates CTAP2 operations
through the WebAuthn API:

```typescript
// JS implementation of Ctap2Transport for FIDO2 plugin
const fido2Transport = {
  async rawSign(challenge: Uint8Array, rpId: string,
                allowCredentials: object[]): Promise<Uint8Array> {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId,
        allowCredentials,
        extensions: { previewSign: { data: challenge } },
      },
    });
    return new Uint8Array(
      assertion.getClientExtensionResults().previewSign.signature
    );
  },
};
```

The WASM FIDO2 plugin wraps this JS callback via `wasm-bindgen`, calling
back into JavaScript for each signing operation. The WebAuthn API handles
BLE/NFC/USB transport to the authenticator transparently.

Security properties: `{ key_storage: "hardware", amr: ["hwk", "rawsign"] }`.

### 3.5 R2PS Plugin via fetch()

The R2PS plugin communicates with a remote PKCS#11 HSM over HTTPS. In the
browser context:

- **HTTP transport**: Implemented as a JS callback wrapping `fetch()`. The
  WASM R2PS plugin calls back into JavaScript for each HTTP round-trip to
  the R2PS service.
- **OPAQUE authentication**: The OPAQUE PAKE (RFC 9807) protocol runs
  inside the WASM module (pure Rust `opaque-ke` crate, WASM-compatible).
  The PIN is collected via the `AuthCallback` which crosses the WASM
  boundary to a JS-side PIN prompt.
- **WebAuthn authentication**: For R2PS instances configured with FIDO2
  auth, the `AuthCallback` triggers `navigator.credentials.get()` in
  JavaScript and returns the assertion to the WASM module.

This means R2PS remote HSM signing is fully available to browser-based
wallets, providing `{ key_storage: "remote_hsm", certification: "high" }`
security properties — the same level as the native SDKs.

**Additional WASM dependencies for R2PS**:

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
# Only needed when plugin-r2ps feature is enabled
opaque-ke = { version = "3", optional = true }
```

The `r2ps-client` crate itself needs a `wasm` feature that replaces
`tokio::task::block_in_place` with `wasm-bindgen-futures` and uses the
JS HTTP callback instead of `reqwest`.

### 3.6 Build and Packaging

The WASM module is built with `wasm-pack`:

```sh
cd siros-wscd-manager
wasm-pack build --target web --features wasm --no-default-features
```

Output: `pkg/siros_wscd_manager.js` + `siros_wscd_manager_bg.wasm`

Published as `@sirosfoundation/wscd-manager-wasm` on **npmjs.com** (public
registry). This makes the package available to any web wallet
implementation without GitHub Packages authentication.

### 3.7 TypeScript Wrapper

A thin TypeScript wrapper (`wscd-manager.ts`) provides typed access:

```typescript
import init, { WasmWscdManager } from '@sirosfoundation/wscd-manager-wasm';

export interface GeneratedKey {
  kid: string;
  publicKeyJwk: JWK;
}

export interface KeyInfo {
  kid: string;
  algorithm: 'ES256' | 'EdDSA';
  plugin_id: string;
  created_at: number;
}

export interface SecurityProperties {
  key_storage: 'software' | 'hardware' | 'remote_hsm' | 'trusted_execution';
  user_authentication: string[];
  certification: 'none' | 'baseline' | 'substantial' | 'high';
  amr: string[];
}

export interface R2psConfig {
  serviceUrl: string;
  clientId: string;
}

export class WscdManager {
  private inner: WasmWscdManager;

  static async create(container?: Uint8Array): Promise<WscdManager>;

  /** Register the softkey (software) plugin. */
  registerSoftkey(container?: Uint8Array): void;

  /** Register the FIDO2 rawSign plugin (requires YubiKey ≥ 5.8). */
  registerFido2(transport: Fido2Transport): void;

  /** Register the R2PS remote HSM plugin. */
  registerR2ps(config: R2psConfig, authCallback: AuthCallback): void;

  async generateKey(algorithm: 'ES256' | 'EdDSA'): Promise<GeneratedKey>;
  async sign(kid: string, data: Uint8Array, algorithm: 'ES256' | 'EdDSA'): Promise<Uint8Array>;
  listKeys(): KeyInfo[];
  async deleteKey(kid: string): Promise<void>;
  exportPublicKey(kid: string): JWK;
  securityProperties(kid: string): SecurityProperties;
  exportContainer(): Uint8Array;
}
```

## 4. Private Data Blob Split

### 4.1 Current State (Schema V3)

A single JWE contains everything:

```
EncryptedContainer {
  mainKey, prfKeys, jwe → WalletStateContainer {
    S: {
      schemaVersion: 3,
      keypairs: [{ kid, keypair: { kid, did, alg, publicKey, privateKey } }],
      credentials: [{ credentialId, format, data, kid, ... }],
      presentations: [{ presentationId, data, usedCredentialIds, ... }],
      settings: { ... },
      credentialIssuanceSessions: [{ sessionId, tokenResponse, dpop, ... }],
    },
    events: [...],
    lastEventHash: "...",
  }
}
```

### 4.2 New State (Schema V4)

Two separate encrypted documents sharing the same `mainKey` and `prfKeys`:

#### 4.2.1 Key Container (WSCA-managed)

```
KeyEncryptedContainer {
  mainKey, prfKeys, jwe → softkey container JSON [
    { kid: "sw-0", algorithm: "ES256", d: "<base64url>", created_at: 1720000000 },
    { kid: "sw-1", algorithm: "ES256", d: "<base64url>", created_at: 1720000001 },
    ...
  ]
}
```

This is the **exact format** produced by
`SoftkeyPlugin::export_container()` — a JSON array of `StoredKey` objects.
The native SDKs already produce and consume this format.

The JWE envelope uses the same `A256GCMKW` / `A256GCM` algorithms and the
same `mainKey` as the state container.

#### 4.2.2 State Container (Event-sourced, TypeScript)

```
StateEncryptedContainer {
  mainKey, prfKeys, jwe → WalletStateContainerV4 {
    S: {
      schemaVersion: 4,
      credentials: [{ credentialId, format, data, kid, ... }],
      presentations: [{ presentationId, data, usedCredentialIds, ... }],
      settings: { ... },
      credentialIssuanceSessions: [{ sessionId, tokenResponse, dpop, ... }],
    },
    events: [...],
    lastEventHash: "...",
  }
}
```

#### 4.2.3 Key Differences from V3

| Aspect | V3 | V4 |
|--------|----|----|
| `keypairs[]` in WalletState | Present (JWK private keys) | **Removed** |
| `new_keypair` event payload | `{ kid, keypair: { privateKey, publicKey, ... } }` | **Replaced** with `{ kid, pluginId, publicKeyJwk }` (metadata only, no private key) |
| `delete_keypair` event | Deletes from state `keypairs[]` | Records kid removal; also calls `wscdManager.deleteKey(kid)` |
| Key storage format | JWK inside event-sourced state | Softkey `StoredKey[]` JSON, managed by WASM |
| Encryption | Single JWE | Two JWEs, same `mainKey` |

### 4.3 Schema V4 Type Definitions

```typescript
// --- WalletStateSchemaVersion4.ts ---

export const SCHEMA_VERSION = 4;

/**
 * V4 keypair metadata — no private key material.
 * Private keys live in the WSCA manager (softkey container).
 */
export type KeypairMetadata = {
  kid: string;
  pluginId: string;       // "softkey", future: "r2ps", "fido2", "native"
  publicKeyJwk: JWK;
  algorithm: 'ES256' | 'EdDSA';
}

/**
 * V4 new_keypair event — records metadata only, no private key.
 */
export type WalletSessionEventNewKeypairV4 = {
  type: "new_keypair";
  kid: string;
  pluginId: string;
  publicKeyJwk: JWK;
  algorithm: 'ES256' | 'EdDSA';
}

/**
 * V4 wallet state — keypairs replaced with metadata-only records.
 */
export type WalletStateV4 = {
  schemaVersion: 4;
  keypairMetadata: KeypairMetadata[];
  credentials: SchemaV3.WalletState['credentials'];
  presentations: SchemaV3.WalletState['presentations'];
  settings: SchemaV3.WalletState['settings'];
  credentialIssuanceSessions: SchemaV3.WalletState['credentialIssuanceSessions'];
}
```

### 4.4 Combined Container Envelope

Both containers share the same key hierarchy but are independent documents:

```typescript
/**
 * The top-level structure stored in IndexedDB and synced to the backend.
 */
export type EncryptedWalletData = {
  /** Shared asymmetric key encapsulation (same for both JWEs) */
  mainKey: EphemeralEncapsulationInfo;
  prfKeys: WebauthnPrfEncryptionKeyInfoV2[];
  passwordKey?: AsymmetricPasswordKeyInfo;

  /** Credential + wallet state (event-sourced, V4 schema) */
  stateJwe: string;

  /** WSCA softkey container (StoredKey[] JSON) */
  keyJwe: string;

  /** Format version for the envelope itself */
  envelopeVersion: 2;
}
```

Both `stateJwe` and `keyJwe` are encrypted with the **same `mainKey`** using
`A256GCMKW` / `A256GCM`. This means:

- A single PRF authentication unlocks both.
- Key rotation (new ephemeral ECDH keypair + new mainKey) re-encrypts both
  JWEs atomically.
- The `mainKey` / `prfKeys` / `passwordKey` structure is identical to the
  existing `AsymmetricEncryptedContainer`.

#### 4.4.1 Backwards Compatibility

The envelope is distinguished from V3 by the presence of `envelopeVersion`:

```typescript
function isV4Envelope(container: unknown): container is EncryptedWalletData {
  return typeof container === 'object'
    && container !== null
    && 'envelopeVersion' in container
    && (container as any).envelopeVersion === 2;
}
```

Legacy containers (no `envelopeVersion` field, single `jwe` field) are
treated as V3 and migrated on first open (Section 6).

## 5. Backend API Changes

### 5.1 Option A: Envelope Approach (Recommended)

The backend continues to store a **single opaque blob** per user. The
`EncryptedWalletData` envelope (containing both `stateJwe` and `keyJwe`)
is serialized as one JSON document and stored in the existing
`privateData` column/field.

**No backend API changes required.**

- Same `GET /user/session/private-data` and
  `POST /user/session/private-data` endpoints.
- Same etag mechanism (SHA-256 of the entire serialized envelope).
- Same optimistic concurrency.

The split is **entirely client-side**. The backend sees one blob; the
client knows it contains two JWEs.

**Trade-off**: Both JWEs are always synced together. A key-only change
(e.g., generating a new keypair) triggers a full blob sync including
unchanged credential state. This is acceptable because:

- The blob is already re-encrypted atomically on every mutation (mainKey
  rotation).
- The sync overhead is dominated by the JWE envelope, not the plaintext
  size.
- Splitting the backend API can be done later (Option B) if performance
  becomes an issue.

### 5.2 Note on Separate Endpoints

Splitting into per-type endpoints (`?type=state`, `?type=keys`) was
considered but is unlikely to provide meaningful benefit. The real bulk
of the private data blob is credential data (SD-JWT/mDL strings), not
key material. The softkey container is typically a few hundred bytes
(a handful of 32-byte P-256 scalars), while a single SD-JWT credential
can be several kilobytes. Separating the endpoints would add API
complexity without reducing sync payload size in practice.

## 6. Migration: V3 → V4

### 6.1 Trigger

Migration occurs on first successful decryption of a V3 container after
the V4 code is deployed. It is performed client-side in
`decryptPrivateData()`.

### 6.2 Migration Steps

```
Input:  V3 AsymmetricEncryptedContainer { mainKey, prfKeys, jwe }
        where jwe decrypts to WalletStateContainer with S.schemaVersion === 3

1. Decrypt jwe with mainKey → WalletStateContainerV3

2. Extract keypairs:
   For each entry in S.keypairs[]:
     Convert CredentialKeyPair to StoredKey:
       { kid: kp.keypair.kid,
         algorithm: kp.keypair.alg,    // "ES256" or "EdDSA"
         d: kp.keypair.privateKey.d,   // base64url P-256 scalar
         created_at: Math.floor(Date.now() / 1000) }

3. Create softkey container:
   softkeyJson = JSON.stringify(storedKeys)

4. Initialize WSCA manager:
   wscdManager = await WscdManager.create(softkeyJson)

5. Build V4 state:
   stateV4 = {
     schemaVersion: 4,
     keypairMetadata: S.keypairs.map(kp => ({
       kid: kp.keypair.kid,
       pluginId: "softkey",
       publicKeyJwk: kp.keypair.publicKey,
       algorithm: kp.keypair.alg,
     })),
     credentials: S.credentials,
     presentations: S.presentations,
     settings: S.settings,
     credentialIssuanceSessions: S.credentialIssuanceSessions,
   }

6. Migrate events:
   For each event in container.events:
     If event.type === "new_keypair":
       Strip privateKey from event payload.
       Replace with { kid, pluginId: "softkey", publicKeyJwk, algorithm }.
     All other events: preserve as-is.

7. Generate new mainKey (key rotation on migration):
   { newMainKey, newMainPublicKeyInfo, newMainPrivateKey } = createAsymmetricMainKey()

8. Encrypt both containers:
   keyJwe = CompactEncrypt(softkeyJson, newMainKey, { alg: "A256GCMKW", enc: "A256GCM" })
   stateJwe = CompactEncrypt(stateV4Container, newMainKey, { alg: "A256GCMKW", enc: "A256GCM" })

9. Re-wrap mainKey for all PRF keys and password key:
   (same re-encapsulation logic as existing updatePrivateData)

10. Emit V4 envelope:
    { envelopeVersion: 2, mainKey: newMainPublicKeyInfo,
      prfKeys: [...], passwordKey: ...,
      stateJwe, keyJwe }

11. Persist to IndexedDB and sync to backend.
```

### 6.3 Rollback Safety

The V3 container is not deleted until the V4 envelope is successfully
persisted to both IndexedDB and the backend. On failure, the V3
container remains valid and the migration retries on next open.

### 6.4 Cross-Platform Considerations

The softkey container format (`StoredKey[]` JSON) is identical across all
platforms. A V4 key container produced by the web wallet can be consumed
by the native SDKs (Kotlin `JweKeystore`, Swift `JweKeystore`) and vice
versa, provided the JWE encryption layer uses the same key hierarchy.

The `keypairMetadata` in the state container is web-specific metadata
that the native SDKs do not use (they maintain their own credential
store). Cross-platform state sync is not a goal of this spec.

## 7. KeystoreAdapter

The `KeystoreAdapter` replaces direct `crypto.subtle` calls in the
current `keystore.ts`. It follows the same pattern as the Kotlin
`WscdKeystoreAdapter`: delegates raw crypto to the WSCA manager,
handles JWT/SD-JWT/mDOC construction locally.

### 7.1 Interface

```typescript
export class KeystoreAdapter {
  constructor(
    private wscdManager: WscdManager,
    private stateContainer: WalletStateContainerV4,
  ) {}

  /**
   * Generate keypairs and return public key metadata.
   * Keys are created in the WSCA manager; metadata recorded in state.
   */
  async generateKeypairs(count?: number): Promise<{
    keypairs: KeypairMetadata[];
    updatedState: WalletStateContainerV4;
  }>;

  /**
   * Generate OID4VCI proof JWTs.
   * Constructs JWT headers/claims in TypeScript, calls wscdManager.sign()
   * for the raw ECDSA signature, assembles compact serialization.
   */
  async generateOpenid4vciProofs(
    nonce: string,
    audience: string,
    issuer: string,
    count?: number,
  ): Promise<{
    proofJwts: string[];
    keypairs: KeypairMetadata[];
    updatedState: WalletStateContainerV4;
  }>;

  /**
   * Sign a VP token (KB-JWT for SD-JWT VP).
   * Imports nothing — calls wscdManager.sign(kid, ...) directly.
   */
  async signJwtPresentation(
    kid: string,
    nonce: string,
    audience: string,
    verifiableCredentials: object[],
  ): Promise<{ vpjwt: string }>;

  /**
   * Generate mDOC DeviceResponse.
   */
  async generateDeviceResponse(
    kid: string,
    mdocCredential: object,
    presentationDefinition: object,
    nonce: string,
    clientId: string,
    responseUri: string,
  ): Promise<{ deviceResponseMDoc: object }>;

  /**
   * Get security properties for a key (for KA request).
   */
  securityProperties(kid: string): SecurityProperties;

  /**
   * Export the WSCA softkey container (cleartext bytes).
   * Caller encrypts via JWE.
   */
  exportKeyContainer(): Uint8Array;
}
```

### 7.2 JWT Construction

JWT header and claims construction stays in TypeScript (using `jose`
library). Only the raw signature operation crosses the WASM boundary:

```typescript
async function signJwt(
  wscdManager: WscdManager,
  kid: string,
  header: object,
  payload: object,
): Promise<string> {
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`
  );

  const signature = await wscdManager.sign(kid, signingInput, 'ES256');
  const encodedSignature = base64url(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}
```

This mirrors the Kotlin `WscdKeystoreAdapter` pattern where `signer.sign()`
provides raw bytes and the adapter assembles the JWT.

## 8. Event Schema Changes

### 8.1 New Event Types (V4)

```typescript
type WalletSessionEventNewKeypairV4 = {
  type: "new_keypair";
  kid: string;
  pluginId: string;
  publicKeyJwk: JWK;
  algorithm: 'ES256' | 'EdDSA';
  // No privateKey — key material lives in WSCA container
}
```

### 8.2 Removed from Events

The `keypair.privateKey` field (JWK with `d` parameter) is no longer
included in `new_keypair` events. V3 events that contain private key
material are accepted during migration but stripped on fold.

### 8.3 Event-to-WSCA Coordination

When a `new_keypair` event is applied:
1. The WSCA manager has already generated the key (via `generateKey()`).
2. The event records only the metadata (`kid`, `pluginId`, `publicKeyJwk`).
3. The key material exists only in the WSCA softkey container.

When a `delete_keypair` event is applied:
1. The event records the `kid`.
2. `wscdManager.deleteKey(kid)` is called.
3. The key is removed from both the state metadata and the softkey container.

### 8.4 Merge Strategy

V4 keypair events use the same merge strategy as V3 (`new_keypair` and
`delete_keypair` deduplicated by `kid`). The merge operates on metadata
only — no private key material is in the event stream.

The softkey container is not event-sourced. It is the authoritative
source for key existence. On merge conflict:

1. Merge the state events normally (existing V3 merge logic for
   credentials, presentations, settings, sessions).
2. The softkey container from the **local** side wins (keys are
   device-bound in the WSCA model).
3. Any `keypairMetadata` entries in the merged state that reference
   keys not present in the local softkey container are removed
   (orphaned metadata cleanup).

## 9. IndexedDB Schema

### 9.1 Current (Version 3)

```
Database: "wallet-frontend", version 3
  Store: "privateData"
    keyPath: "userHandle"
    Record: { userHandle: string, content: EncryptedContainer }
```

### 9.2 New (Version 4)

```
Database: "wallet-frontend", version 4
  Store: "walletData"
    keyPath: "userHandle"
    Record: { userHandle: string, content: EncryptedWalletData }
```

Migration from IndexedDB v3 to v4:

1. On `onupgradeneeded(3 → 4)`:
   - Create new store `walletData`.
   - Do NOT delete `privateData` store yet (needed for data migration).
2. On first open after upgrade:
   - Read from `privateData` store.
   - Run V3→V4 migration (Section 6).
   - Write to `walletData` store.
   - Delete record from `privateData` store.

## 10. Security Considerations

### 10.1 Key Material Isolation

In the V3 model, key material (JWK `d` parameter) appears in:
- The decrypted `WalletStateContainer` in JavaScript memory.
- The event stream (in `new_keypair` events).
- The folded state (`S.keypairs[]`).

In the V4 model, key material:
- Lives inside the WASM linear memory (in the `SoftkeyPlugin`
  `HashMap<String, StoredKey>`).
- Is not passed across the WASM boundary by any API other than
  `export_container()`, which the caller immediately encrypts.
- Is not present in the TypeScript event stream or state.

> **Correction (v0.3).** Version 0.2 of this document additionally claimed
> that "the WASM module's linear memory is not accessible to JavaScript",
> and rested the security case for this migration on that claim. **The claim
> is false for the in-page model.** `wasm-pack build --target web` exports the
> module's `memory`, so `wasm.memory.buffer` is a plain `ArrayBuffer` that any
> same-origin script can read. In-page WASM therefore provides **no
> confidentiality boundary against the page's own JavaScript** — an attacker
> who can run script in the wallet origin can read key material out of linear
> memory just as they could read it out of `S.keypairs[]` today.
>
> What the in-page model *does* buy is real, but it is narrower than §10.1
> previously stated:
> - Key material stops appearing in the event stream and the folded state, so
>   it is no longer written to IndexedDB or synced to the backend in
>   cleartext-at-rest form inside the decrypted blob.
> - The number of places in TypeScript that touch a private key drops to
>   zero, which shrinks the accidental-logging and accidental-serialisation
>   surface.
> - One key-management implementation is shared with the native SDKs.
>
> The original isolation property **does** hold in the extension model (D1),
> where the background service worker is a separate origin and a separate
> process from page script. If §10.1 is load-bearing for this migration, that
> argues for the extension; if implementation-sharing is the actual goal,
> in-page is simpler. This document should not continue to assert both.

### 10.2 Container Export

`export_container()` returns cleartext key material. The caller (TypeScript
encryption layer) MUST encrypt it before persisting. This is the same
contract as the native SDKs.

### 10.3 Side-Channel Considerations

The Rust `SoftkeyPlugin` uses `p256` and `ed25519-dalek` which implement
constant-time operations. WASM execution may or may not preserve
constant-time properties depending on the JavaScript engine's JIT
compilation. This is a known limitation shared with all WASM-based
cryptographic implementations and is acceptable for the `Software`
key storage tier.

For the R2PS and FIDO2 plugins, the sensitive cryptographic operations
occur on the remote HSM or hardware authenticator respectively — the
WASM module only handles protocol framing, not key material.

## 11. privatedata-spec Updates

The `privatedata-spec/SPEC.md` (currently v2.0) must be updated to v3.0
to document:

1. The `EncryptedWalletData` envelope format with `envelopeVersion: 2`.
2. The dual-JWE structure (`stateJwe` + `keyJwe`).
3. The V4 `WalletStateContainer` schema (no `keypairs[]`, has
   `keypairMetadata[]`).
4. The softkey container format (`StoredKey[]` JSON) as normative.
5. Migration rules from envelope v1 (legacy, single `jwe`) to v2.
6. The `mainKey` sharing model (both JWEs use the same key).

## 12. Cross-Client Compatibility

### 12.1 Current Client Landscape

Multiple clients share the same backend private data blob:

| Client | Keystore | Blob behavior |
|--------|----------|---------------|
| **wallet-frontend** | WebCrypto + JWE | Reads/writes V3 blob with events. Authoritative. |
| **Kotlin SDK (JweKeystore)** | Same JWE container | Round-trips blob verbatim (`preservedWalletState`). |
| **Kotlin SDK (WscdKeystoreAdapter)** | WSCD manager | Folds `signer.exportPrivateKeypairs()` into the credentials keystore, then exports. |
| **Swift SDK (JweKeystore)** | Same JWE container | Same verbatim round-trip as Kotlin. |
| **Swift SDK (WscdKeystoreAdapter)** | WSCD manager | Implements `exportEncryptedContainer()`. |

### 12.2 Key Finding

**wallet-frontend is still the only client that meaningfully reads AND
writes the private data blob today**, but not for the reason v0.2 of this
document gave. Native SDK `JweKeystore` (legacy path) returns the blob
verbatim on export — it never overwrites wallet-frontend's data, but also
never persists its own in-session changes.

The surviving cross-client hazard is a different one, and it is a live
data-loss path rather than a prerequisite: `privatedata-spec` §6.1 documents
a top-level `S.wscdCredentials` field that the native SDKs MAY write, marks
it **"not yet normative"**, and notes that wallet-frontend's typed reducers
**silently drop it** on the next write. A user who moves between a native
wallet and the web wallet therefore loses that state. This needs closing on
its own merits, independently of D1, D2 and everything else in this
document — see §12.3.

### 12.3 Native SDK Prerequisites (Phase 0)

> **Correction (v0.3).** Version 0.2 of this document listed two blocking
> prerequisites — that `WscdKeystoreAdapter.exportEncryptedContainer()`
> throws in Kotlin and returns `{}` in Swift, and that
> `CredentialPersistence` is unwired. **Both are now implemented and this
> section is no longer blocking.** Kotlin folds
> `signer.exportPrivateKeypairs()` into the credentials keystore via
> `importKeypairJwk()` before delegating, and adds
> `exportWscdCredentialsState()`, `exportCredentialRefreshTokens()` and
> `exportFido2State()`; Swift implements `exportEncryptedContainer()` in
> `Sources/SirosKeystore/WscdKeystoreAdapter.swift`.

The one item that remains, replacing the two above:

1. **Resolve `S.wscdCredentials`** (§12.2). Either make it normative in
   `privatedata-spec` and add a wallet-frontend reducer that preserves it,
   or drop it from the native SDKs in favour of local encrypted storage.
   Add a conformance vector for whichever is chosen.

This is blob-format-neutral — it doesn't change the envelope written to the
backend — and can ship independently of every other phase. It is **not** a
gate on Phase 1 or Phase 2; it is a correctness bug that happens to live in
the same area.

### 12.4 Compatibility Strategy

The migration uses a **V3-compatible intermediate step** (Phase 2) that
lets wallet-frontend use the WASM `WscdManager` internally while
continuing to write V3-format blobs. This avoids cross-client breakage:

```
Phase 0:  Fix native SDK credential persistence (no blob changes)
Phase 1:  Build WASM module (no blob changes)
Phase 2:  wallet-frontend uses WASM internally, writes V3 blobs
          ↑ SAFE: all clients see the same V3 format
Phase 3:  Blob split to V4 envelope (gate on Phase 0 complete)
          ↑ SAFE: native SDKs no longer depend on blob for credentials
```

In Phase 2, the `KeystoreAdapter` generates keys via the WASM
`WscdManager` but serializes them back into `S.keypairs[]` in V3 format
for the blob. Keys live in both the WASM softkey container (in-memory)
and in the blob (for cross-device sync). This is a transitional state
that can run indefinitely.

## 13. Implementation Phases

Status as of 2026-08-27 is tracked in
[siros-wscd-manager#66](https://github.com/sirosfoundation/siros-wscd-manager/issues/66),
which carries a task graph with IDs and dependencies. Phases 0 and 1 are
largely complete; the checklists below are marked accordingly.

### Phase 0: Native SDK Bug Fixes (prerequisite, no blob changes)

**Done** — see the §12.3 correction. What replaces it:

| Task | Repo | Risk |
|------|------|------|
| ~~Wire `CredentialPersistence` into `WscdKeystoreAdapter`~~ | siros-sdk-kotlin / -swift | Done |
| ~~Fix `buildWalletStateV3()` to merge in-memory state~~ | siros-sdk-kotlin / -swift | Done |
| Resolve `S.wscdCredentials` reducer gap (§12.2) | privatedata-spec + wallet-frontend | Low — fixes live data loss |

### Phase 1: WASM Build (siros-wscd-manager)

Mostly done. `@sirosfoundation/wscd-manager-wasm` is published on npmjs.com
and `0.8.0` is live.

- [x] Add `wasm` feature flag and conditional compilation.
      (`wasm = plugin-softkey-pure + plugin-fido2` and the wasm-bindgen stack.)
- [x] Gate `uniffi`, `tokio/rt`, `josekit/openssl`.
- [x] Replace `SystemTime::now()` — done via `src/timeutil.rs`, not `web-time`.
- [x] CI: `wasm-pack test --headless --chrome --no-default-features --features wasm`
      — a real browser test, not just `cargo check --target wasm32`.
- [x] Publish `@sirosfoundation/wscd-manager-wasm` on **npmjs.com**.
- [~] `wasm-bindgen` exports — the module is `src/wasm_ffi.rs`, not
      `src/wasm.rs`, and it exposes **softkey only**. `WscdManagerJs` has 9
      methods against 24 in `src/ffi.rs`.
- [ ] **FIDO2 is not reachable from JavaScript.** `src/wasm_fido2.rs` is a
      complete browser `Ctap2Transport` over the WebAuthn `previewSign`
      extension — its wire shape was taken from PR #22's `sign-extension.ts`,
      so it is known-good against real hardware — but
      `WscdManagerJs::new()` only ever registers `SoftkeyPlugin` and there is
      no `registerFido2()` export. The whole hardware path ships in the npm
      bundle as dead code. *This is the single cheapest high-value fix in the
      plan* (#66 task W-1).
- [ ] `generateKey()` / `sign()` hardcode `Algorithm::ES256`; `SoftkeyPlugin`
      already supports `EdDSA` and §3.7 below specifies both (W-2).
- [ ] `listKeys()` returns bare `string[]`, not the `KeyInfo[]` of §3.7. The
      dropped `plugin_id` is exactly what §4.3's
      `keypairMetadata.pluginId` is populated from, so this blocks Phase 3
      (W-3).
- [ ] `AuthCallback` is a stub — `WasmNoopAuth` returns `AuthCancelled` from
      both methods, so no plugin needing user authentication can work in the
      browser (W-4).
- [ ] Adapt `r2ps-client` crate for WASM (`fetch()`-based transport,
      `wasm-bindgen-futures` instead of `block_in_place`). The `wasm` feature
      currently omits `plugin-r2ps` entirely, so §3.5 below is unimplemented
      (W-5).
- [ ] Lifecycle API (`register_lifecycle`, activate/destroy/rotate) exists in
      `src/ffi.rs` but not in WASM; issue #148 needs it (W-6).
- [ ] Ship the hand-written TypeScript wrapper of §3.7 — only the
      wasm-bindgen-generated `.d.ts` is published today (W-8).

### Phase 2: wallet-frontend Integration (V3-compatible)

1. Add `@sirosfoundation/wscd-manager-wasm` dependency.
2. Implement `WscdManager` TypeScript wrapper.
3. Implement `KeystoreAdapter` bridging WSCA → protocol operations.
4. **Write V3-format blobs**: keys managed by WASM but serialized into
   `S.keypairs[]` in the existing V3 schema. On load, populate the WASM
   softkey container from `S.keypairs[]`. On save, export softkey
   container back into `S.keypairs[]`.
5. `security_properties` sent with KA requests.
6. Unit tests for `KeystoreAdapter` (mock `WscdManager`).
7. End-to-end testing — verify blob is readable by native SDKs.

This phase can ship independently of Phase 0. No blob format changes.
All three WSCD plugins (softkey, FIDO2 rawSign, R2PS) are available
to wallet-frontend users through the WASM `WscdManager`.

### Phase 3: Storage Split (V4 envelope) — gate on D2

Phase 0 is no longer the gate (§12.3). **D2 is** — decide whether this phase
happens at all before starting it.


1. Define `WalletStateSchemaVersion4.ts` types.
2. Define `EncryptedWalletData` envelope type.
3. Implement dual-JWE encryption/decryption in `keystore.ts`.
4. Update IndexedDB schema (v3 → v4).
5. Implement `migrateV3ToV4()` migration.
6. Update `updatePrivateData()` / `syncPrivateData()`.
7. Update `privatedata-spec/SPEC.md` to v3.0.
8. Integration tests with V3 test vectors.

### Phase 4: Wire Up and Cleanup

1. Replace `generateKeypairs()` call sites with `KeystoreAdapter`.
2. Replace `signJwtPresentation()` call sites.
3. Replace `generateDeviceResponse*()` call sites.
4. Remove V3 `keypairs[]` code paths.
5. End-to-end testing with `sirosid-tests`.
