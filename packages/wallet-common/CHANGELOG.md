# wallet-common

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
