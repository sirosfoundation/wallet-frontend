---
"wallet-frontend": patch
---

Await server logout before clearing authentication tokens to prevent a race during session cleanup.
