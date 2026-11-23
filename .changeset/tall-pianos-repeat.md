---
"wallet-frontend": patch
---

Fall back to a `jwt` proof when the attestation proof fails, so issuance no longer ends in "Credential issuance failed" where the issuer would have accepted `jwt`
