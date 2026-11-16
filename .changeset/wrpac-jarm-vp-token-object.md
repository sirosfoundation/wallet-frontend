---
"wallet-frontend": patch
---

Fix the client-held `direct_post.jwt` (JARM) response to carry `vp_token` in the
OpenID4VP 1.0 §8.1 object form: a JSON object with one member per Credential
Query, the key the query's `id`, the value an array of that query's
presentations. A bare vp_token string is now restructured under the sign
request's `credentialsToInclude` credential query ids — the same newline-split,
count-checked, in-order restructure the engine's own non-encrypted path
performs (go-wallet-backend's `buildDCQLVPToken`, which direct_post.jwt
bypasses by relaying the client's JWE verbatim). Verifiers enforcing the final
shape (including the OIDF conformance suite's own client) reject the previous
bare-string form with `malformed`/`invalid response` — found live in the SIROS
WRPAC drill, where every cross-device presentation against
siros-verifier-core v0.1.4 failed at this last hop.
