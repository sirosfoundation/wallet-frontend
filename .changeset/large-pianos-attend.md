---
"wallet-frontend": patch
---

Forward `request_uri_method` and `wallet_metadata` on OID4VP flow start, so a verifier asking for the POST of OpenID4VP §5.10 is honoured instead of silently downgraded to a GET
