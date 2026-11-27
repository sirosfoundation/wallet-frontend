---
"wallet-frontend": patch
---

Fix the `direct_post.jwt` response's vp_token to carry the OpenID4VP 1.0
§8.3.1 object form (keyed by credential query id), mirroring the
engine's own builder — a bare token string is rejected by final-spec
verifiers.
