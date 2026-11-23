# wallet-common

## 0.1.2

### Patch Changes

- Fix tests timing out by [@smncd](https://github.com/smncd) in [#476](https://github.com/sirosfoundation/wallet-frontend/pull/476)

## 0.1.1

### Patch Changes

- Upgrade dependencies by [@smncd](https://github.com/smncd) in [#471](https://github.com/sirosfoundation/wallet-frontend/pull/471)
- Updated dependencies [[`a79b869`](https://github.com/sirosfoundation/wallet-frontend/commit/a79b869a50a76133b27ae90b8be8240c8bcdfefc)]:
  - @sirosfoundation/http-client@0.1.1
  - @sirosfoundation/result@0.1.1

## 0.1.0

### Minor Changes

- Merge wallet-common package into wallet-frontend by [@smncd](https://github.com/smncd) in [#325](https://github.com/sirosfoundation/wallet-frontend/pull/325)
- Standalone `HttpClient` package by [@smncd](https://github.com/smncd) in [#337](https://github.com/sirosfoundation/wallet-frontend/pull/337)

### Patch Changes

- Move `Result`, `err()` and `ok()` into new `@sirosfoundation/result` package by [@smncd](https://github.com/smncd) in [#421](https://github.com/sirosfoundation/wallet-frontend/pull/421)
- use ` credentialIssuer?.credentialIssuerIdentifier` rather than `iss` as source for issuer metadata fetching by [@smncd](https://github.com/smncd) in [#418](https://github.com/sirosfoundation/wallet-frontend/pull/418)
- Verify SD-JWT VC type metadata integrity over the bytes as served instead of a re-serialised parse, so `#integrity` hashes computed by issuers match by [@jessevanmuijden](https://github.com/jessevanmuijden) in [#334](https://github.com/sirosfoundation/wallet-frontend/pull/334)
- Convert the CBOR decoded value into a plain JSON-compatible structure during mDoc parsing by [@smncd](https://github.com/smncd) in [#343](https://github.com/sirosfoundation/wallet-frontend/pull/343)
- Updated dependencies [[`c88d039`](https://github.com/sirosfoundation/wallet-frontend/commit/c88d0391dedf0e2de1c0e90643c15e079e644928), [`d5592cd`](https://github.com/sirosfoundation/wallet-frontend/commit/d5592cdaae055e9569fb0fe8fbc9517c8566ad39)]:
  - @sirosfoundation/result@0.1.0
  - @sirosfoundation/http-client@0.1.0

## 0.1.0-beta.2

### Patch Changes

- use ` credentialIssuer?.credentialIssuerIdentifier` rather than `iss` as source for issuer metadata fetching by [@smncd](https://github.com/smncd) in [#418](https://github.com/sirosfoundation/wallet-frontend/pull/418)

## 0.1.0-beta.1

### Patch Changes

- Convert the CBOR decoded value into a plain JSON-compatible structure during mDoc parsing by [@smncd](https://github.com/smncd) in [#343](https://github.com/sirosfoundation/wallet-frontend/pull/343)

## 0.1.0-beta.0

### Minor Changes

- Merge wallet-common package into wallet-frontend by [@smncd](https://github.com/smncd) in [#325](https://github.com/sirosfoundation/wallet-frontend/pull/325)
- Standalone `HttpClient` package by [@smncd](https://github.com/smncd) in [#337](https://github.com/sirosfoundation/wallet-frontend/pull/337)

### Patch Changes

- Verify SD-JWT VC type metadata integrity over the bytes as served instead of a re-serialised parse, so `#integrity` hashes computed by issuers match by [@jessevanmuijden](https://github.com/jessevanmuijden) in [#334](https://github.com/sirosfoundation/wallet-frontend/pull/334)
- Updated dependencies [[`d5592cd`](https://github.com/sirosfoundation/wallet-frontend/commit/d5592cdaae055e9569fb0fe8fbc9517c8566ad39)]:
  - @sirosfoundation/http-client@0.1.0-beta.0
