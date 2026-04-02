# V2 Branch Analysis and Recommendations

## Overview

This document analyzes the relationship between two refactoring branches:

| Branch | Scope | Timeline | Status |
|--------|-------|----------|--------|
| `v2` | Broad frontend restructure | Nov 2025 - Jan 2026 | Stalled |
| `feature/v2-api` | Protocol/transport abstraction + multi-tenancy | Jan 2026 - Present | Active |

## Branch Comparison

### v2 Branch (94 files, +4262/-2105 lines)

**Architectural approach:** Complete frontend restructure

Key changes:
- **Redux store** (`src/store/`) replacing context-based state management
- **CoreWrappers pattern** - `ClientStateStore`, `CoreHttpProxy`, `VpTokenSigner` wrapping `@wwwallet/client-core`
- **UriHandler rewrite** as state machine with separate handler components
- **Direct protocol rewrites** - OpenID4VP/VCI logic moved into frontend
- **Migration managers** for wallet state credentials/presentations
- **Structured logging** with `src/logger.ts`
- **YAML config** replacing environment variables

### feature/v2-api Branch (61 files, +6126/-321 lines)

**Architectural approach:** Transport abstraction + multi-tenancy

Key changes:
- **Transport abstraction** (`src/lib/transport/IFlowTransport.ts`):
  - `WebSocketTransport` - real-time flow orchestration
  - `HttpProxyTransport` - existing backend proxy wrapped
  - `DirectTransport` - stub for future CORS support
- **Multi-tenancy** (`src/lib/tenant.ts`, `TenantContext`, `TenantSelector`)
- **Capabilities discovery** - `/status` endpoint for feature detection
- **Flow hooks** - `useOID4VCIFlow`, `useOID4VPFlow`, `useWebSocketSignHandler`
- **Token refresh handling** with automatic 401 retry

### Overlapping Files (19 potential conflicts)

Both branches modify:
- `src/config.ts`
- `src/lib/services/HttpProxy/HttpProxy.ts`
- `src/services/LocalStorageKeystore.ts`
- `src/pages/Login/Login.tsx`
- `src/api/index.ts`
- `src/hocs/UriHandlerProvider.tsx`

---

## Async/Await Architecture Analysis

### The Problem

Developers have noted that wallet-frontend doesn't make proper use of async/await, making it difficult to introduce user feedback in asynchronous flows like pre-authorized credential issuance.

**Assessment: Valid but overstated** - the issues are fixable, not fundamental.

### Specific Issues

#### 1. Mixed async patterns in `UriHandlerProvider.tsx`

The main flow handler declares `async function handle()` but uses `.then()` chains:

```typescript
// Current problematic pattern (lines 138-162)
handleCredentialOffer(u.toString()).then(({ ... }) => {
    return requestCredentialsWithPreAuthorization(...);
}).then((res) => {
    // no intermediate state update possible
}).catch(err => {
    // error handling only at END
})
```

This prevents inserting loading states or progress indicators between steps.

#### 2. No intermediate state updates

Flows run "fire and forget" - UI only updates at success/failure. Cannot show:
- "Fetching credential offer..."
- "Authenticating with token endpoint..."
- "Requesting credential..."

#### 3. Blocking `prompt()` calls

Pre-auth flow uses native `prompt()` for tx_code input:

```typescript
while (1) {
    userInput = prompt(txCode.description ?? "Input Transaction Code...")
    // ...
}
```

This blocks the event loop - React cannot re-render.

#### 4. Callbacks vs. State-based flows

`OpenID4VCI` service uses `useCallback` hooks returning promises. The caller (`UriHandlerProvider`) chains these without visibility into intermediate steps.

### Why It's Fixable

The **service layer** (`OpenID4VCI.ts`) is well-structured with proper async/await internally.

The **feature/v2-api branch already solves this** with:
- `useOID4VCIFlow.ts` - Flow hook with `isLoading` state
- Progress callbacks in `WebSocketTransport`
- `onProgress` event subscriptions

---

## Recommendations: Backports from v2

### HIGH Priority - Adopt

#### 1. Logger with structured output (`src/logger.ts`)

**Value:** High | **Effort:** Low

```typescript
export class Logger {
    level: LogLevel;
    levelColors: Record<LogLevel, string> = {
        error: "#FF5C5C",
        info: "#4DA6FF",
        warn: "#FFAA00",
        debug: "#9E9E9E",
    }
    // Console binding for proper stack traces
    // jsonToLog() helper for structured data
}
```

Benefits:
- Colored log level prefixes
- Console binding preserves stack traces
- `jsonToLog()` for human-readable structured output
- Improves WebSocket transport debugging

#### 2. Error Dialog pattern (`ErrorDialogContext`)

**Value:** Medium | **Effort:** Low

```typescript
type ErrorDialogState = {
    title: string;
    description: string;
    emphasis?: string;
    err?: Error;
    onClose?: () => void;
}
```

Benefits:
- Typed error state
- Consistent UX for error handling
- `useErrorDialog()` hook cleaner than ad-hoc popups

### MEDIUM Priority - Consider

#### 3. Protocol step type definitions

**Value:** Medium | **Effort:** Low

```typescript
type ProtocolStep =
    | "authorization_request"
    | "authorize"
    | "generate_presentation"
    | "send_presentation"
    | "presentation_success"
    | "protocol_error"
    | "credential_request"
    | "error"
```

Benefits:
- Explicit state typing for flow hooks
- Better than ad-hoc string states in `useOID4VCIFlow`/`useOID4VPFlow`

#### 4. Date formatting utility (`formatDate.js`)

**Value:** Low | **Effort:** Low

Handles Unix timestamps, ISO 8601, and various date formats uniformly.

#### 5. Migration Manager pattern

**Value:** Medium | **Effort:** Medium (when needed)

```typescript
function useWalletStateCredentialsMigrationManager(...) {
    const migrated = useRef(false);
    // Run once on login
    // Transform old data to new schema
    // Track completion
}
```

Keep in mind for future schema changes rather than implementing now.

### NOT Recommended

| Component | Reason |
|-----------|--------|
| Redux store | Too invasive; conflicts with context pattern |
| CoreWrappers | Superseded by transport abstraction |
| UriHandler state machine | Hook-based approach in v2-api is cleaner |
| YAML config | Adds complexity without clear benefit |

---

## UriHandlerProvider Refactoring

### Current State (Problems)

```typescript
// Fire-and-forget chain with no feedback
handleCredentialOffer(url).then(result => {
    return requestCredentialsWithPreAuthorization(...);
}).then(res => {...}).catch(...)
```

### Target State (Fixed)

```typescript
// Proper async/await with state updates
setStatus('fetching-offer');
const offer = await handleCredentialOffer(url);

if (offer.preAuthorizedCode) {
    setStatus('requesting-code');
    const txCodeInput = await showTxCodeDialog(offer.txCode); // React popup

    setStatus('requesting-credential');
    const result = await requestCredentialsWithPreAuthorization(...txCodeInput);

    setStatus('complete');
}
```

### Required Changes

| Issue | Fix | Effort |
|-------|-----|--------|
| Mixed `.then()`/`await` | Refactor to pure async/await | Medium |
| No loading states | Add `useState` for step tracking | Low |
| Blocking `prompt()` | Use `PinInputPopup` component | Low |
| No progress events | Adopt transport abstraction | Medium |

---

## Conclusion

**feature/v2-api** is the better foundation because:
1. **Incremental adoption** - transport abstraction allows gradual migration
2. **Backend flexibility** - supports HTTP proxy, WebSocket, and future direct CORS
3. **Multi-tenancy** - addresses real operational requirement
4. **Lower risk** - changes are additive rather than restructuring

The async/await issues are **code-quality problems**, not architectural flaws. The service layer is sound; only the orchestration layer needs refactoring.

---

## Priority Summary

### P0 - Immediate (can merge independently)
1. Logger implementation
2. Error Dialog pattern

### P1 - Short-term (with next feature work)
3. Protocol step type definitions for flow hooks
4. Replace `prompt()` with React popup in pre-auth flow
5. Refactor UriHandlerProvider to async/await

### P2 - Medium-term (when needed)
6. Date formatting utility
7. Migration manager pattern (for future schema changes)

### Declined
- Redux store migration
- CoreWrappers pattern
- YAML configuration
- UriHandler state machine rewrite
