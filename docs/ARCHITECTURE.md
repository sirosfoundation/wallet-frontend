# Architecture

## Introduction

This document is meant to serve as guidelines for how to organise code in the
`sirosfoundation/wallet-frontend` repository. This document describes how code
in the `sirosfoundation/wallet-frontend` repository should be organised. It is
not a set of hard rules, and a change shall not necessarily be rejected just for
breaking it, but it SHOULD be followed unless there is a good reason not to (see
section 6).

The overall principle is small, self-contained, testable modules: business logic
is written in plain TypeScript, that React uses and renders the result.

### Key words

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
document are to be interpreted as described in RFC 2119.

In tables, REQ is short for REQUIRED, OPT is short for OPTIONAL, CON is short
for CONDITIONAL.

## 1. Goals and Principles

### 1.1 Keep business logic plain and testable

Business logic MUST be kept separate from the UI. It SHOULD be written as plain
TypeScript, meaning no React or other UI framework imports. Third-party
dependencies MAY be used where necessary. This lets business logic be tested
without rendering any UI.

Business logic SHOULD be portable, so it can be reused outside this React app
(tests, other apps, workers). How strict this is depends on where the code
lives:

- **In `src/`**: business logic MAY import app-specific modules such as
  configuration or logging directly.
- **In `packages/`**: business logic MUST NOT import from `src/`. App-specific
  things like configuration, logging, and storage MUST be passed in through
  generic interfaces.

Where WASM is used, it MUST be wrapped in a TypeScript module. The rest of the
application MUST use the wrapper, not the WASM module directly.

### 1.2 Expose clear public APIs

Business logic SHOULD be exposed through a public API whose names describe what
it does, not how it does it (e.g. `signSdJwtPresentation`, not `dispatch`). Side
effects, such as network requests, storage writes, user prompts, or changes to
shared state, MUST be clear from the method name or documented in a JSDoc
comment.

### 1.3 React owns presentation

React components own rendering and presentation state, such as open dialogs,
form input, and loading indicators. They MUST NOT reimplement business rules;
they SHOULD call into business logic instead.

### 1.4 Prefer cohesive modules

A package or business logic module SHOULD serve one clear purpose. That purpose
MAY span several steps or concerns, for example a protocol flow that parses,
matches, signs, and sends. Logic that is useful on its own SHOULD live in its
own module and be used by the flow, not built into it.

Catch-all modules that group unrelated logic SHOULD be avoided. New logic SHOULD
go where it belongs, not into an existing module just because it is convenient.

## 2. Application Architecture

### 2.1 `src/` and `packages/`

`src/` contains the React application: components, pages, contexts, providers,
and hooks. It is also where services are created and wired together. Business
logic that is specific to this app MAY also live in `src/`.

`packages/` contains reusable business logic with explicit dependencies.
Packages MUST NOT depend on React or import from `src/` but MAY depend on
eachother.

### 2.2 Stateful business logic

React reaches stateful business logic through providers, contexts, and hooks:

- **Providers** create service instances, pass in their dependencies, and own
  their lifetime. An instance SHOULD stay the same across renders. It MUST be
  cleaned up or replaced when it is no longer valid, for example on logout or
  when the provider unmounts.
- **Contexts** hold the service instance, not its changing state. Putting
  frequently changing state in a context makes every consumer re-render.
- **Hooks** get the service from its context and subscribe to its state. A hook
  MUST NOT create its own service instance.

When a service's state changes, React SHOULD be notified so the UI updates. The
RECOMMENDED way is for the service to offer a subscribe method and read its
state in React with `useSyncExternalStore`.

A stateful service MAY omit the provider and be created directly in a hook, if
each consumer should have its own instance. This is only acceptable when the
instance is cheap to create, shares nothing with other instances, and can be
cleaned up when its component unmounts. The instance MUST be created once, for
example with `useState(() => new ...)`, not on every render.

#### Example

The context holds the instance:

```typescript
// src/context/HttpClientContext.ts
export const HttpClientContext = createContext<HttpClient | null>(null);
```

The provider creates one instance and keeps its dependencies up to date:

```tsx
// src/providers/HttpClientProvider.tsx
export function HttpClientProvider({ children }: PropsWithChildren) {
  const { isOnline } = useContext(StatusContext);
  const { obliviousKeyConfig } = useContext(SessionContext);

  const transport = useMemo(
    () =>
      obliviousKeyConfig
        ? createOhttpTransport(OHTTP_RELAY, obliviousKeyConfig)
        : axiosHttpTransport,
    [obliviousKeyConfig],
  );

  const [client] = useState(
    () => new HttpClient({ isOnline, transport, logger, indexedDB }),
  );

  useEffect(() => {
    client.setIsOnline(isOnline);
    client.setTransport(transport);
  }, [client, isOnline, transport]);

  return (
    <HttpClientContext.Provider value={client}>
      {children}
    </HttpClientContext.Provider>
  );
}
```

The hook only reads the instance from context:

```typescript
// src/hooks/useHttpClient.ts
export function useHttpClient(): HttpClient {
  const client = useContext(HttpClientContext);
  if (!client) throw new Error('Missing HttpClientProvider');
  return client;
}
```

Services with state that the UI needs, such as protocol flows, also expose
`subscribe` and `getSnapshot` methods. Their hooks read that state with
`useSyncExternalStore`.

### 2.3 Stateless business logic

Stateless functions, such as parsers, validators, or credential matching, SHOULD
be imported and called directly. They SHOULD NOT be wrapped in a provider,
context, or hook.

If a stateless function needs a stateful service, such as `HttpClient`, the
service SHOULD be passed in as an argument. The function MUST NOT call a hook to
get it.

#### Example

```tsx
// src/components/TenantForm.tsx
import { isValidTenantId } from '@/lib/tenant';

export function TenantForm() {
  const [tenantId, setTenantId] = useState('');
  const isValid = isValidTenantId(tenantId);
  // ...
}
```

## 3. Code Style

Basic formatting (tabs, line endings, trailing whitespace) is defined in
`.editorconfig`.

### 3.1 Line length

Lines SHOULD NOT exceed 80 columns. This applies to code, comments, and
Markdown.

### 3.2 Quotes

Strings SHOULD use single quotes. JSX and HTML attributes SHOULD use double
quotes.

```tsx
const label = 'Continue';

return <Button variant="primary">{label}</Button>;
```

### 3.3 Top to bottom

When a file contains multiple functions, they MUST be sorted into the order that
they are called in: a function comes before the functions it calls. If
`export function B()` is us by `function A()`, it MUST be placed after A. If
`function B()` is also used by `export function C()`, it SHOULD be placed after
C. This applies for standalone functions as well as classes.

```typescript
export async function acceptOffer(offerUri: string) {
  const offer = parseOffer(offerUri);
  // ...
  const issurr = await fetchIssuerMetadata(offer.issuer);
}

function parseOffer(offerUri: string): Offer {
  // ...
}

async function fetchIssuerMetadata(issuer: OfferIssuer): IssuerMetadata {
  // ...
}
```

### 3.4 Group code into blocks

Code SHOULD be split into small blocks of related lines, separated by an empty
line. Each block should do one step, so the function reads top to bottom.

```typescript
async function acceptOffer(offerUri: string) {
  const offer = parseOffer(offerUri);
  const issuer = await fetchIssuerMetadata(offer.issuer);

  const token = await requestToken(issuer, offer.grant);

  const proof = await createProof(issuer, token.nonce);
  const credential = await requestCredential(issuer, token, proof);

  await storeCredential(credential);
  return credential;
}
```

### 3.5 Private methods

TypeScript class methods that are private SHOULD be written like
`#methodName()` instead of `private methodName()`, since the latter is only
private during type checking, and not at runtime.

### 3.6 Readability over cleverness

Code SHOULD be written to be easy to read, not to be short or clever. Prefer
clear names, early returns, and plain `if` statements over nested ternaries,
long chains, or dense one-liners. Single-character variables are highly
discouraged.

## 4. Target Structure

### 4.1 Overview

```text
packages/       # Reusable business logic, no React
src/            # The React application
```

`src/` MAY depend on `packages/`. `packages/` MUST NOT depend on `src/` (see
2.1).

### 4.2 `src/`

```text
src/
    app/
        App.tsx
        routes.ts
    assets/                 # App-specific assets like SVG's and pictures.
    components/             # React components.
        <domain>/
        shared/             # Components not tied to a domain.
    context/                # React contexts.
    hooks/                  # React hooks.
    lib/                    # App-specific business logic
        <domain>/
    locales/                # Localized strings for app.
    pages/                  # Route-level components.
    providers/              # React providers. MAY be context providers.
    config.ts
    i18n.ts
    index.tsx
    logger.ts
    sw.ts
```

`components/`, `context/`, `providers/`, and `hooks/` are top-level directories.
Within them, files MAY be grouped by domain, e.g. `components/credentials/`.

`lib/` holds business logic that is specific to this app. Each subdirectory
SHOULD be one cohesive module (see 1.4), e.g. `lib/keystore/` or
`lib/wscd-manager/`.

The `hocs/`, `api/`, and `services/` directories are deprecated. New features
should not be added there.

### 4.3 `packages/`

```text
packages/
    <package-name>/
        src/
            index.ts        # Public API
        package.json
        tsconfig.json
```

A package SHOULD expose its public API through `src/index.ts`. Consumers SHOULD
NOT import from a package's internal files. Logic in `src/lib/` that becomes
reusable SHOULD be moved into a package. Packages MAY depend on each other.
These dependencies MUST be declared in `package.json`.

Packages SHOULD be marked as `"private": true` in `package.json`, but MAY be
marked as public, if they're intended to be pushed to NPM or any other package
registry.

A package MAY expose it's TypeScript source code directly, or bundle it into
plain JavaScript. The package MUST do the latter if it's a public package.

### 4.4 File names and exports

Directory names MUST be kebab-case. File names follow what the file exports:

| File contents                      | Case       | Example                             |
| ---------------------------------- | ---------- | ----------------------------------- |
| Class, React component, context    | PascalCase | `HttpClient.ts`, `TenantForm.tsx`   |
| A single function, including hooks | camelCase  | `useHttpClient.ts`, `parseOffer.ts` |
| Anything else                      | kebab-case | `tenant.ts`, `credential-types.ts`  |

A file SHOULD export one React component, and the file name MUST match it.
Private helper components MAY live in the same file.

## 5. Testing Strategy

There are three kinds of tests:

| Kind        | Tests                                 | Fakes                        | Tool       |
| ----------- | ------------------------------------- | ---------------------------- | ---------- |
| Unit        | One file                              | All of its dependencies      | Vitest     |
| Integration | Several real modules working together | Only network and storage     | Vitest     |
| End-to-end  | The whole app in a real browser       | Nothing, or external servers | Playwright |

Integration and end-to-end tests live at the repository level:

```text
tests/
    e2e/
    fixtures/       # Shared test data
    helpers/        # Shared test utilities
    integration/
```

### 5.1 Unit tests

A unit test file MUST sit next to the file it tests and share its name, e.g.
`HttpClient.ts` and `HttpClient.test.ts`. It MUST only test that file. A file
MUST NOT have more than one unit test file. Each package MUST include unit tests
for its own files.

Business logic SHOULD be tested without React. Dependencies such as
`HttpClient`, storage, or a logger SHOULD be passed in as fakes. Module mocks
(`vi.mock`) MAY be used when a dependency cannot be passed in, such as
third-party modules or browser APIs.

```typescript
const transport = createFakeTransport();
const client = new HttpClient({ isOnline: true, logger, transport });
```

React code SHOULD be tested with its services faked through their context, not
by mocking hook modules:

- **Providers**: test that they create one instance, keep its dependencies up to
  date, and clean it up when they should.
- **Hooks**: test that they read from the context and update when the service's
  state changes.
- **Components**: test what the user sees and does.

```tsx
render(
  <HttpClientContext.Provider value={fakeClient}>
    <TenantForm />
  </HttpClientContext.Provider>,
);
```

### 5.2 Integration tests

Integration tests check that real modules work together, for example a flow
service using a real `HttpClient` and keystore, or a page rendered with its real
providers. Only the edges of the app SHOULD be faked, such as the network
transport or IndexedDB.

Integration tests MUST live in `tests/integration/`.

### 5.3 End-to-end tests

End-to-end tests run the built app in a real browser and go through complete
user journeys, such as signing up, receiving a credential, and presenting it.
They MUST live in `tests/e2e/`.

End-to-end tests SHOULD test behaviour, not logic: what the user does and sees,
not how the app works internally.

### 5.4 Fixtures and helpers

Shared test data MUST live in `tests/fixtures/`, and shared test utilities in
`tests/helpers/`. Unit tests in `packages/` MUST NOT import from `tests/`, so
that packages stay self-contained (see 2.1).

## 6. Migrating existing code

Parts of the codebase may not follow this document. Known deviations SHOULD be
tracked as issues, not in this document.

- New code SHOULD follow this document. It MAY follow the surrounding code
  instead, if following this document would need a refactor larger than the
  change itself.
- Existing code SHOULD be migrated step by step, not in one large rewrite.
- A change SHOULD either restructure code or change behaviour, not both.
- Logic SHOULD be moved once it is clear what it does and what it depends on.
  Existing code is a starting point, not a pattern to copy.
- Working code is more important than correct structure. A change SHOULD NOT be
  blocked only because it does not follow this document.

## Open Questions

These questions are not decided yet. When one is answered, the answer SHOULD be
added to the relevant section and the question removed.

- How should OpenID flows and the existing transport subsystem be divided, if at
  all?
- Should browser APIs be injected into business logic or used directly at
  package edges?
- Where should private-data synchronization and session orchestration live?
- Should a stable flow service represent one active transaction or support
  multiple concurrent transactions?
