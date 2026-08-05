# Wallet Instance Attestation (WIA)

This wallet can authenticate itself to a credential issuer using a wallet-provider-signed attestation (per [draft-ietf-oauth-attestation-based-client-auth](https://www.ietf.org/archive/id/draft-ietf-oauth-attestation-based-client-auth-10.html)) instead of a pre-registered OAuth `client_id`. This lets any issuer that trusts the wallet's provider (via go-trust's PDP) accept credential requests without an admin manually registering this wallet deployment.

## Where the logic lives

All attestation generation is transport-agnostic, in `src/lib/services/OpenID4VCI/WIA.ts`:

- `requestWIA()` — signs a WIA-request PoP and calls go-wallet-backend's `/wallet-provider/wia/challenge` + `/wallet-provider/wia/generate` to obtain the WIA itself.
- `buildClientAttestationPop()` — signs the *per-flow* PoP that accompanies the WIA on the actual PAR/token request to the credential issuer.
- `generateFlowAttestation()` — the single entry point transports call: generates a fresh keypair, requests a WIA, and returns the two header VALUES (`oauth-client-attestation`, `oauth-client-attestation-pop`) as strings. Every transport that talks to a credential issuer needs the same two values, generated the same way, once per flow; only the wire encoding differs per transport.

`useOID4VCIFlow.ts` calls `generateFlowAttestation()` once before dispatching to whichever transport is active, and passes the resulting strings through `OID4VCIFlowParams.clientAttestation`/`clientAttestationPoP` (defined in `OID4VCITypes.ts`). This is deliberate: attestation must work identically regardless of transport (WebSocket today; WMP/native SDK later), so it is generated once, transport-independently, rather than duplicated per transport implementation.

## Three different values that are easy to conflate

Getting WIA working end-to-end surfaced two real bugs, both from conflating values that are similar-looking but must be distinct:

| Value | What it actually is | Used as |
|-------|---------------------|---------|
| `clientId` | The wallet's own OAuth `client_id` for *this* flow — `OPENID4VCI_REDIRECT_URI` (matches go-wallet-backend's own default: `h.clientID = h.redirectURI` for unregistered clients, OID4VCI §7.1 convention; the same value `OpenID4VCIHelper.ts` already falls back to elsewhere) | The WIA's `sub` claim, and the per-flow PoP's `iss` claim |
| `credentialIssuer` | The credential issuer's own URL, parsed from the credential offer | The per-flow PoP's `aud` claim — it's sent *to* the issuer's PAR/token endpoint |
| `walletProviderURI` (`ENGINE_URL`) | go-wallet-backend's own URL | The **WIA-request** PoP's `aud` claim — a *different* PoP, sent to go-wallet-backend's own `/wallet-provider/wia/generate`, never to the credential issuer |

**Bug 1 — `clientId` was set to `credentialIssuer`.** `useOID4VCIFlow.ts` originally passed `parsedOffer.credentialIssuer` as the WIA's client_id, based on an incorrect assumption about go-wallet-backend's fallback. Confirmed live against `vc-apigw`'s logs: `invalid_client: wallet attestation subject does not match client_id`, because the WIA's `sub` (issuer URL) never matched the PAR's actual `client_id` (the wallet's own redirect URI).

**Bug 2 — the per-flow PoP's `aud` was set to `clientId` instead of `credentialIssuer`.** `generateFlowAttestation()` originally called `attachWalletAttestationHeaders({}, {wia, keyPair}, clientId, clientId)` — passing `clientId` for both the PoP's issuer *and* its audience. Since the PoP is sent to the credential issuer's PAR endpoint, its audience must be the issuer's URL, not the wallet's own URL. Confirmed live: `attestation PoP validation failed: PoP aud [...wallet-frontend...] does not contain expected audience [...vc-apigw...]`.

Both are fixed by giving `generateFlowAttestation()` a fourth, explicit `credentialIssuer` parameter distinct from `clientId` — see its call site in `useOID4VCIFlow.ts` and the regression test in `WIA.test.ts` that decodes the PoP's `aud`/`iss` claims to assert they differ correctly.

## Two PoPs, two audiences

There are always two separate PoP JWTs in play, never one reused for both purposes:

1. **WIA-request PoP** — proves possession of the attestation key to go-wallet-backend itself, when requesting the WIA. `aud` = the wallet provider (`ENGINE_URL`).
2. **Per-flow PoP** — proves possession of the same key to the credential issuer, attached to the actual PAR/token request. `aud` = the credential issuer.

Both are signed by the same freshly-generated keypair (the WIA's `cnf.jwk`), but never share an audience.

## Configuration

Controlled by `WIA_ENABLED` (from `@/config`) and `OPENID4VCI_REDIRECT_URI`. When disabled, or when go-wallet-backend doesn't support WIA, `generateFlowAttestation()` degrades silently to `{}` (no attestation headers) rather than throwing — WIA is a Tier 3 (informative/best-effort) enhancement, not a hard requirement for issuance to work.

## Related

- go-wallet-backend: `internal/service/wia.go` (WIA generation), `internal/service/wallet_provider_jwks.go` (JWKS + RFC 8414 metadata the issuer resolves the wallet provider's key from).
- SUNET/vc: `docs/TRUST_AND_IDENTITY.md`'s "Wallet Attestation" section (issuer-side verification and trust evaluation).
- developers.siros.org: [Wallet Attestation](https://developers.siros.org/docs/sirosid/trust/wallet-attestation) and the attestation-based authentication how-to guide.
