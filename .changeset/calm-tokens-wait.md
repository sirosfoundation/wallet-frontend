---
"wallet-frontend": patch
---

Wait for the backend token before reporting the OID flow transport ready, so a credential offer opened on page load no longer fails with "No transport available"
