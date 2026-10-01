# wallet-frontend

## 0.6.0

### Minor Changes

- Add DC API integration with native wrapper apps by [@smncd](https://github.com/smncd) in [#182](https://github.com/sirosfoundation/wallet-frontend/pull/182)
- Introduce Wallet Instance Attestation (Tier 3) into OID4VCI flow by [@leifj](https://github.com/leifj) in [#196](https://github.com/sirosfoundation/wallet-frontend/pull/196)
- Breaking: remove deprecated `http_proxy` flow and implementation by [@smncd](https://github.com/smncd) in [#263](https://github.com/sirosfoundation/wallet-frontend/pull/263)
- Allow OpenID flows to block any updates to the web app itself by [@smncd](https://github.com/smncd) in [#302](https://github.com/sirosfoundation/wallet-frontend/pull/302)

### Patch Changes

- fix: preserve dc_api.jwt response envelope by [@leifj](https://github.com/leifj) in [#195](https://github.com/sirosfoundation/wallet-frontend/pull/195)
- Stop remounting the credential layout on every render by [@jessevanmuijden](https://github.com/jessevanmuijden) in [#320](https://github.com/sirosfoundation/wallet-frontend/pull/320)
- Move credential matching service to `src/lib/services` by [@smncd](https://github.com/smncd) in [#297](https://github.com/sirosfoundation/wallet-frontend/pull/297)
- send bearer token in auth header to WIA endpoints by [@smncd](https://github.com/smncd) in [#295](https://github.com/sirosfoundation/wallet-frontend/pull/295)
- Upgrade dependencies by [@smncd](https://github.com/smncd) in [#298](https://github.com/sirosfoundation/wallet-frontend/pull/298)
- Fix `mdoc` credential matching by [@smncd](https://github.com/smncd) in [#292](https://github.com/sirosfoundation/wallet-frontend/pull/292)
- Bump dockerfile build base image to trixie by [@smncd](https://github.com/smncd) in [#299](https://github.com/sirosfoundation/wallet-frontend/pull/299)
- Start using `changesets` for versioning by [@smncd](https://github.com/smncd) in [#275](https://github.com/sirosfoundation/wallet-frontend/pull/275)
- Fix Wallet Instance Attestation spec gaps. Move all sign handling to frontend. by [@smncd](https://github.com/smncd) in [#288](https://github.com/sirosfoundation/wallet-frontend/pull/288)
- moved utils to a src/lib/utils, added new testfiles and changed imports in files. by [@lov1saconde](https://github.com/lov1saconde) in [#312](https://github.com/sirosfoundation/wallet-frontend/pull/312)
- Remove `http_proxy` from the default value in transports config by [@smncd](https://github.com/smncd) in
- fixed welcome tour csp problems. by [@lov1saconde](https://github.com/lov1saconde) in [#294](https://github.com/sirosfoundation/wallet-frontend/pull/294)
- fix: if engine sends back `attestation_challenge`, include it in client attestation PoP by [@smncd](https://github.com/smncd) in [#313](https://github.com/sirosfoundation/wallet-frontend/pull/313)
- Handle expired sessions, letting the user re-authenticate wherever they are by [@smncd](https://github.com/smncd) in [#305](https://github.com/sirosfoundation/wallet-frontend/pull/305)

## 0.6.0-beta.3

### Patch Changes

- Remove `http_proxy` from the default value in transports config by [@smncd](https://github.com/smncd) in

## 0.6.0-beta.2

### Minor Changes

- Breaking: remove deprecated `http_proxy` flow and implementation by [@smncd](https://github.com/smncd) in [#263](https://github.com/sirosfoundation/wallet-frontend/pull/263)
- Allow OpenID flows to block any updates to the web app itself by [@smncd](https://github.com/smncd) in [#302](https://github.com/sirosfoundation/wallet-frontend/pull/302)

### Patch Changes

- Move credential matching service to `src/lib/services` by [@smncd](https://github.com/smncd) in [#297](https://github.com/sirosfoundation/wallet-frontend/pull/297)
- Upgrade dependencies by [@smncd](https://github.com/smncd) in [#298](https://github.com/sirosfoundation/wallet-frontend/pull/298)
- Bump dockerfile build base image to trixie by [@smncd](https://github.com/smncd) in [#299](https://github.com/sirosfoundation/wallet-frontend/pull/299)
- moved utils to a src/lib/utils, added new testfiles and changed imports in files. by [@lov1saconde](https://github.com/lov1saconde) in [#312](https://github.com/sirosfoundation/wallet-frontend/pull/312)
- fix: if engine sends back `attestation_challenge`, include it in client attestation PoP by [@smncd](https://github.com/smncd) in [#313](https://github.com/sirosfoundation/wallet-frontend/pull/313)
- Handle expired sessions, letting the user re-authenticate wherever they are by [@smncd](https://github.com/smncd) in [#305](https://github.com/sirosfoundation/wallet-frontend/pull/305)

## 0.6.0-beta.1

### Patch Changes

- send bearer token in auth header to WIA endpoints by [@smncd](https://github.com/smncd) in [#295](https://github.com/sirosfoundation/wallet-frontend/pull/295)
- fixed welcome tour csp problems. by [@lov1saconde](https://github.com/lov1saconde) in [#294](https://github.com/sirosfoundation/wallet-frontend/pull/294)

## 0.6.0-beta.0

### Minor Changes

- Add DC API integration with native wrapper apps by [@smncd](https://github.com/smncd) in [#182](https://github.com/sirosfoundation/wallet-frontend/pull/182)
- Introduce Wallet Instance Attestation (Tier 3) into OID4VCI flow by [@leifj](https://github.com/leifj) in [#196](https://github.com/sirosfoundation/wallet-frontend/pull/196)

### Patch Changes

- Fix `mdoc` credential matching by [@smncd](https://github.com/smncd) in [#292](https://github.com/sirosfoundation/wallet-frontend/pull/292)
- Start using `changesets` for versioning by [@smncd](https://github.com/smncd) in [#275](https://github.com/sirosfoundation/wallet-frontend/pull/275)
- Fix Wallet Instance Attestation spec gaps. Move all sign handling to frontend. by [@smncd](https://github.com/smncd) in [#288](https://github.com/sirosfoundation/wallet-frontend/pull/288)
