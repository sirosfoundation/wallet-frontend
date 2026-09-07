# Wallet Instance Attestation (WIA)

This wallet can authenticate itself to a credential issuer using a wallet-provider-signed attestation (per [draft-ietf-oauth-attestation-based-client-auth](https://www.ietf.org/archive/id/draft-ietf-oauth-attestation-based-client-auth-10.html)) instead of a pre-registered OAuth `client_id`. This lets any issuer that trusts the wallet's provider (via go-trust's PDP) accept credential requests without an admin manually registering this wallet deployment.

## Where the logic lives

The attestation primitives are transport-agnostic, in `src/lib/services/WIA.ts`:

- `requestWIA()` — signs a WIA-request PoP and calls go-wallet-backend's `/wallet-provider/wia/challenge` + `/wallet-provider/wia/generate` to obtain the WIA itself.
- `buildClientAttestationPop()` — signs the *per-flow* PoP that accompanies the WIA on the actual PAR/token request to the credential issuer's authorization server.
- `generateFlowAttestation()` — generates a fresh keypair, requests a WIA bound to it, and returns the two header VALUES (`oauth-client-attestation`, `oauth-client-attestation-pop`) as strings.

The wallet no longer generates the attestation up front. The **engine drives it**: over the WebSocket transport, go-wallet-backend resolves the credential offer and issuer metadata server-side, then — once it knows the issuer's authorization server (the per-flow PoP's audience) — sends a `request_attestation` sign_request. `src/hooks/useOIDFlowSignHandler.ts`'s `generateClientAttestation` answers it by calling `generateFlowAttestation()` and returning `{ clientAttestation, clientAttestationPoP }` over the same sign channel used for `generate_proof` (holder-binding proofs) and `sign_presentation` (VP tokens).

Why engine-driven: a browser can't fetch a `credential_offer_uri` itself (CORS), and doesn't know the authorization server until the engine resolves metadata. So the engine asks for the WIA at the point the audience is known, rather than the wallet resolving the offer up front. On the backend this is `requestClientAttestation` in `internal/engine/oid4vci.go`, keyed by `SignActionRequestAttestation` (`internal/engine/messages.go`).

The older up-front path still exists for transports that *can* resolve the authorization server before starting the flow (native SDK / WMP): they populate `OID4VCIFlowParams.clientAttestation`/`clientAttestationPoP` on flow start, and the backend prefers those when present, falling back to the `request_attestation` step otherwise. The browser WebSocket path no longer populates them.

## Three different values that are easy to conflate

Three similar-looking values must stay distinct. Over the engine-driven path the first two are supplied by the backend in the `request_attestation` sign request's params; the third is frontend config.

| Value | What it actually is | Used as |
|-------|---------------------|---------|
| `clientId` (`params.issuer`) | The engine's resolved OAuth `client_id` for this flow — the credential issuer's registered client_id, or the wallet's `redirect_uri` for unregistered clients (`h.clientID` in `internal/engine/oid4vci.go`, OID4VCI §7.1 convention) | The WIA's `sub` claim, and the per-flow PoP's `iss` claim |
| `authorizationServerIssuer` (`params.audience`) | The credential issuer's **authorization server** issuer identifier, resolved by the engine from metadata (`h.authServerIssuer`) | The per-flow PoP's `aud` claim — it's sent *to* the AS's PAR/token endpoint |
| `walletProviderURI` (`BACKEND_URL`) | go-wallet-backend's own URL, where the `/wallet-provider/wia/*` endpoints are co-hosted | The **WIA-request** PoP's `aud` claim — a *different* PoP, sent to go-wallet-backend's own `/wallet-provider/wia/generate`, never to the credential issuer |

Two mistakes are easy here, and both were hit during the original up-front implementation: using the credential issuer's URL as `clientId` (the WIA `sub` then never matches the PAR's `client_id`, and the AS rejects with `invalid_client: wallet attestation subject does not match client_id`), and using `clientId` as the per-flow PoP's `aud` (the AS rejects it, since the PoP is presented *to* the AS). The engine-driven design sidesteps both by having the backend hand the frontend the authoritative `issuer` and `audience` directly — `generateClientAttestation` just forwards `params.issuer` and `params.audience` into `generateFlowAttestation()`.

> Note: `walletProviderURI` is `BACKEND_URL`, **not** `ENGINE_URL` — the `/wallet-provider/wia/*` endpoints are served by the backend, and this value must match the backend's `WALLET_WALLET_PROVIDER_WIA_WALLET_PROVIDER_URI`.

## Two PoPs, two audiences

There are always two separate PoP JWTs in play, never one reused for both purposes:

1. **WIA-request PoP** — proves possession of the attestation key to go-wallet-backend itself, when requesting the WIA. `aud` = the wallet provider (`BACKEND_URL`).
2. **Per-flow PoP** — proves possession of the same key to the credential issuer's authorization server, attached to the actual PAR/token request. `aud` = the authorization server issuer.

Both are signed by the same freshly-generated keypair (the WIA's `cnf.jwk`), but never share an audience.

## Known limitations

Both are documented in `generateClientAttestation` (`src/hooks/useOIDFlowSignHandler.ts`) and are *not* fixed:

1. **One PoP reused for PAR + token.** The engine requests the attestation once and replays the same WIA + per-flow PoP on both the PAR and the token request (and on any DPoP-nonce retry). An authorization server that enforces single-use PoP `jti` would reject the second use. A per-request PoP would require the engine to re-request one before each outgoing request.
2. **`cnf` ≠ DPoP key over WebSocket.** The WIA's `cnf` key is a fresh key minted client-side in `generateFlowAttestation()`, whereas the token's DPoP key is generated engine-side. So the two differ, and strict `cnf == DPoP` binding (EC TS03 §2.2.1.1) is not satisfied on this transport. Fine for Tier 3 client authentication (WIA replacing a pre-registered `client_id`); only an issuer enforcing key binding would care.

## Configuration

**Frontend:** gated by `WIA_ENABLED` (from `@/config`). When disabled, or when the client returns no attestation, `generateFlowAttestation()` / `generateClientAttestation` degrade silently to `{}` — the backend then proceeds without wallet attestation. WIA is a Tier 3 (informative/best-effort) enhancement, not a hard requirement for issuance to work.

**Backend:** requires a wallet-provider signing key (`WALLET_WALLET_PROVIDER_PRIVATE_KEY_PATH` etc.) — without it the `/wallet-provider/wia/*` endpoints aren't registered — plus the WIA settings (`WALLET_WALLET_PROVIDER_WIA_*`). Crucially, `WALLET_WALLET_PROVIDER_WIA_WALLET_PROVIDER_URI` must equal the frontend's `BACKEND_URL`, since that's the `aud` the frontend puts on the WIA-request PoP. For localhost / go-trust dev, use `WALLET_WALLET_PROVIDER_WIA_MODE: ietf` (JWKS-based trust).

## Related

- go-wallet-backend: `internal/engine/oid4vci.go` (`requestClientAttestation`, the engine-driven step), `internal/engine/messages.go` (`SignActionRequestAttestation` + the `client_attestation`/`client_attestation_pop` sign-response fields), `internal/service/wia.go` (WIA generation), `internal/service/wallet_provider_jwks.go` (JWKS + RFC 8414 metadata the issuer resolves the wallet provider's key from).
- SUNET/vc: `docs/TRUST_AND_IDENTITY.md`'s "Wallet Attestation" section (issuer-side verification and trust evaluation).
- developers.siros.org: [Wallet Attestation](https://developers.siros.org/docs/sirosid/trust/wallet-attestation) and the attestation-based authentication how-to guide.
