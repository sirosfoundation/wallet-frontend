# Format Handling & Security Gap Plan

Status: **Draft**
Scope: wallet-common, wallet-frontend
Date: 2025-07-15

---

## Background

Review feedback and internal analysis identified gaps in credential format handling,
type safety, and security posture across the wallet stack. The recent wallet-common
update (`45a8e67..246121b`) added the `JWT_VC_JSON` enum value, the `canParse`/
`UnsupportedFormat` pattern in `ParsingEngine`, and format guard functions — but the
actual `jwt_vc_json` parser, verifier, and `ParsedCredential` union arm are still
missing.

This document triages all identified gaps, assigns severity and priority, and
proposes an implementation order based on dependency chains.

---

## Gap Inventory

### CRITICAL — Type-system holes that break at runtime

| # | Gap | Repo | Location | Root Cause |
|---|-----|------|----------|------------|
| C1 | `ParsedCredential` type has no `jwt_vc_json` arm | wallet-common | `src/types.ts` ~L60-82 | Union only covers SD-JWT and MSO_MDOC |
| C2 | No `JWTVCJSONParser` exists | wallet-common | `src/credential-parsers/` | Enum added, implementation not yet created |
| C3 | No `JWTVCJSONVerifier` exists | wallet-common | `src/credential-verifiers/` | Same as C2 |
| C4 | `CredentialsContextProvider` format switch has no `default` | wallet-frontend | `src/context/CredentialsContextProvider.tsx` L151-158 | Silent fall-through for unknown formats |
| C5 | `deriveHolderKidFromCredential` returns `undefined` for jwt_vc_json | wallet-frontend | `src/lib/services/OpenID4VCI/OpenID4VCI.ts` L37-60 | Only handles SD-JWT and MSO_MDOC branches |

### HIGH — Type-safety and correctness issues

| # | Gap | Repo | Location | Root Cause |
|---|-----|------|----------|------------|
| H1 | wallet-common pinned at stale `45a8e67` | wallet-frontend | `package.json` L47 | Missing `JWT_VC_JSON` enum, `canParse` pattern |
| H2 | `OID4VCIFlowResult.format` typed as `string` | wallet-frontend | `src/lib/transport/types/OID4VCITypes.ts` ~L105 | Should be `VerifiableCredentialFormat` |
| H3 | Duplicated format switch in `useFetchPresentations.js` | wallet-frontend | `src/hooks/useFetchPresentations.js` L69-78 | Copy-paste of `CredentialsContextProvider` switch |
| H4 | String literal `"mso_mdoc"` instead of enum | wallet-frontend | `src/pages/Home/Credential.jsx` L147 | Bypasses type checking |
| H5 | `as any` casts in DCQL handling | wallet-common | `OpenID4VPServerAPI.ts` L365, `OpenID4VPClientAPI.ts` L337-340, `SDJWTVCVerifier.ts` L51 | Missing types for dcql-presentation library |
| H6 | Format from issuer metadata stored without re-parsing | wallet-frontend | `OpenID4VCI.ts` L126 → `LocalStorageKeystore.ts` L720-729 | Issuer-claimed format trusted blindly |
| H7 | `WebSocketTransport.mapOID4VCIResponse()` casts format to `string` | wallet-frontend | `src/lib/transport/WebSocketTransport.ts` ~L349 | Bypasses enum; first entry-point for server-supplied format |

### MEDIUM — Hygiene and defence in depth

| # | Gap | Repo | Location | Root Cause |
|---|-----|------|----------|------------|
| M1 | Dead code: `CredentialParserRegistry.ts` + `ICredentialParser.ts` | wallet-frontend | `src/lib/services/`, `src/lib/interfaces/` | Superseded by wallet-common `ParsingEngine`; never imported |
| M2 | Bearer token in `sessionStorage` (plaintext) | wallet-frontend | `src/lib/services/HttpProxy/HttpProxy.ts` L168, L277 | Standard browser session practice, but XSS-reachable |
| M3 | Empty catch blocks in QR scanner | wallet-frontend | `src/utils/qr/qr-scanner.ts` L292, L1215 | Silent failures during camera/overlay setup |
| M4 | `CredentialParserRegistry` catch → null (silent) | wallet-frontend | Dead code (see M1), but pattern should not be copied |

### LOW — Longer-term improvements

| # | Gap | Repo | Location | Note |
|---|-----|------|----------|------|
| L1 | No credential revocation check on delete | wallet-frontend | `LocalStorageKeystore.ts` L744-758 | Spec-dependent; may require status-list integration |
| L2 | IndexedDB cache not encrypted at rest | wallet-frontend | `src/indexedDB.ts` | Cache only, not credential data; risk is session leakage |

---

## Interaction with feature/v2-api Transport Refactoring

The `feature/v2-api` branch adds a new transport layer (`IFlowTransport` /
`WebSocketTransport` / `HttpProxyTransport` / `DirectTransport`) and moves
OID4VCI type definitions into `src/lib/transport/types/OID4VCITypes.ts`.
This is the file where gap **H2** lives — it exists only on the branch, not
on master.

The v2-api branch also touches several files targeted by this plan, but the
changes are limited to import cleanup (`wallet-common/dist/*` → `wallet-common`)
and `console.*` → `logger.*` — **none of the format-handling code paths are
modified**, so no merge conflicts are expected.

**Files touched by both plans (no conflict):**

| File | v2-api changes | Gap plan changes |
|------|---------------|------------------|
| `OpenID4VCI.ts` | Import cleanup, `console`→`logger`, OAuth PAR refactor | C5, H6 |
| `CredentialsContextProvider.tsx` | Import cleanup, `console`→`logger` | C4 |
| `useFetchPresentations.js` | Import cleanup, `console`→`logger` | H3 |
| `Credential.jsx` | `buildPath` tenant navigation | H4 |

**New transport files that carry format values:**

| File | Concern |
|------|---------|
| `WebSocketTransport.ts` | `mapOID4VCIResponse()` casts `response.format as string` → needs enum validation (H7) |
| `OID4VCITypes.ts` | `format?: string` → needs `VerifiableCredentialFormat` (H2) |

All gap-plan work should target the `feature/v2-api` branch directly.

---

## Dependency Graph

```
wallet-common (must ship first)
  │
  ├─ C1  ParsedCredential jwt_vc_json union arm
  │    └─ C2  JWTVCJSONParser (depends on C1 type)
  │         └─ C3  JWTVCJSONVerifier (depends on C2 parsed output)
  │
  ├─ H5  as-any cleanup (independent, parallel with C1-C3)
  │
  └─ Release / tag
      │
      └─ wallet-frontend (depends on wallet-common release)
            │
            ├─ H1  Bump wallet-common pin
            │    ├─ C4  Add default cases to format switches
            │    ├─ C5  jwt_vc_json branch in deriveHolderKidFromCredential
            │    ├─ H2  Narrow OID4VCIFlowResult.format to enum
            │    ├─ H3  Deduplicate format switches (factory/shared function)
            │    ├─ H4  Replace string literals with enum
            │    └─ H7  Validate format in WebSocketTransport.mapOID4VCIResponse()
            │
            ├─ H6  Re-parse format at storage time (independent)
            │
            ├─ M1  Remove dead CredentialParserRegistry (independent)
            ├─ M2  Bearer token hardening (independent)
            └─ M3  QR scanner error propagation (independent)
```

---

## Implementation Plan

### Phase 1 — wallet-common: jwt_vc_json foundation

**Goal:** Ship a wallet-common release that fully supports `jwt_vc_json` as a
first-class credential format, with the same parse/verify contract as SD-JWT and
MSO_MDOC.

#### 1a. `ParsedCredential` type — extend the union (C1)

Add a third union arm to `ParsedCredential` in `src/types.ts`:

```typescript
| { format: VerifiableCredentialFormat.JWT_VC_JSON; parsedCredential: ParsedJwtVcJson }
```

Define `ParsedJwtVcJson` with at minimum:
- `header: JwtHeader` (alg, kid, typ, …)
- `payload: Record<string, unknown>` (decoded JWT claims)
- `signature: string` (base64url)
- `raw: string` (original compact JWT)

Use Zod schema validation consistent with existing parsers.

#### 1b. `JWTVCJSONParser` (C2)

Create `src/credential-parsers/JWTVCJSONParser.ts`:
- Implement `canParseJwtVcJson(raw: unknown)`: check string, exactly 2 dots, typ
  header is NOT `vc+sd-jwt` / `dc+sd-jwt` (to not collide with SD-JWT guard).
- Parse: base64url-decode header and payload, validate with Zod schema.
- Return `UnsupportedFormat` when guard fails.
- Register in `ParsingEngine` **after** SDJWTVCParser (SD-JWT is more specific).

#### 1c. `JWTVCJSONVerifier` (C3)

Create `src/credential-verifiers/JWTVCJSONVerifier.ts`:
- Accept `ParsedJwtVcJson` from parser output.
- Verify JWS signature (compact serialization) against issuer public key.
- Validate `exp`, `nbf`, `iss` claims.
- Register in `VerifyingEngine`.

#### 1d. `as any` cleanup (H5)

- `OpenID4VPServerAPI.ts` L365: type the DCQL query `credentials` array properly
  (import or declare the type from `dcql` library).
- `OpenID4VPClientAPI.ts` L337-340: type the `output` and `claims` from
  `DcqlPresentationResult` (may need upstream type exports or a local type
  declaration).
- `SDJWTVCVerifier.ts` L51: add `cnf` to the `ParsedSdJwtVcWithPrettyClaims` type
  interface so the cast is unnecessary.

### Phase 2 — wallet-frontend: consume updated wallet-common

**Goal:** Bump the wallet-common dependency, integrate jwt_vc_json support into the
UI, and fix all format-handling type-safety gaps.

#### 2a. Bump wallet-common (H1)

Update `package.json` to point to the wallet-common commit/tag from Phase 1.
Run `npm install` and fix any type errors surfaced by the new types.

#### 2b. Format switch hardening (C4, H3)

- Extract a shared format-dispatch function (or use a `Record<VerifiableCredentialFormat, Handler>` map) in a utility module.
- Replace the switches in `CredentialsContextProvider.tsx` and
  `useFetchPresentations.js` with calls to this shared function.
- The shared function must include a jwt_vc_json branch and an exhaustive default
  that throws (TypeScript `never` guard).

#### 2c. `deriveHolderKidFromCredential` (C5)

Add jwt_vc_json branch in `OpenID4VCI.ts`:
- Decode JWT header, extract `kid`.
- If no `kid`, derive from `cnf.jwk` in the payload.
- Add exhaustive default (throw on unknown format).

#### 2d. Type narrowing and transport validation (H2, H4, H7)

- `OID4VCITypes.ts`: change `format?: string` to
  `format?: VerifiableCredentialFormat`.
- `Credential.jsx` L147: replace `"mso_mdoc"` with
  `VerifiableCredentialFormat.MSO_MDOC`.
- `WebSocketTransport.ts` `mapOID4VCIResponse()`: replace the bare
  `result.format = response.format as string` cast with enum validation.
  This is the first point where the server-supplied format string enters the
  frontend — validate against `Object.values(VerifiableCredentialFormat)` and
  reject or flag unknown values before they propagate into `OID4VCIFlowResult`.

#### 2e. Format validation at storage boundary (H6)

In the OID4VCI credential receipt flow (`OpenID4VCI.ts` L126-170):
- After receiving the credential bytes, **re-parse** through `ParsingEngine` to
  confirm the actual format matches the issuer-claimed format.
- If mismatch, reject the credential with a user-visible error.
- This prevents a malicious issuer from labelling an SD-JWT as `mso_mdoc` (or vice
  versa), which would cause silent failures downstream.

### Phase 3 — Cleanup and hardening

#### 3a. Remove dead code (M1)

Delete:
- `src/lib/services/CredentialParserRegistry.ts`
- `src/lib/interfaces/ICredentialParser.ts`

#### 3b. QR scanner error handling (M3)

Replace the two empty `catch (e) {}` blocks in `qr-scanner.ts` (L292, L1215) with
at minimum `console.warn` calls, or propagate errors where they affect user-visible
behaviour (camera access failure).

#### 3c. Bearer token storage review (M2)

Evaluate feasibility of:
- Moving the token to an `HttpOnly` cookie (eliminates XSS exfiltration).
- If cookies are not viable (CORS constraints), add a short token TTL and ensure the
  Content-Security-Policy is tight enough to mitigate reflected XSS.

This is a design decision — document the trade-offs and decide with the team.

---

## Out of Scope

| Item | Reason |
|------|--------|
| PinInput hardcoded refs / `type="text"` | PR already expected |
| Credential revocation on delete (L1) | Depends on issuer revocation endpoint spec; track separately |
| IndexedDB encryption at rest (L2) | Cache only, not credential data; low residual risk |

---

## Sequencing Summary

| Order | Items | Blocked by | Estimated scope |
|-------|-------|------------|-----------------|
| 1 | C1, C2, C3, H5 | — | wallet-common: 3 new files, 1 type extension, 3 cast fixes |
| 2 | H1 | Phase 1 release | wallet-frontend: dependency bump |
| 3 | C4, C5, H2, H3, H4, H6, H7 | H1 | wallet-frontend: 6 files, ~180 LOC |
| 4 | M1, M2, M3 | — (can parallel) | wallet-frontend: deletions + minor edits |
