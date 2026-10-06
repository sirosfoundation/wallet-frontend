# Wallet Frontend Configuration

Wallet frontend has extensive environment configuration options. These are consumed at runtime and used to generate the frontend configuration.

## Meta

`meta` variables are consumed by the frontend at runtime through the `www:config` meta tag.

| Key | Type | Description | Required | Default |
| --- | ---- | ----------- | -------- | ------- |
| `ALLOWED_TRANSPORTS` | `array` | Allowed transports (comma-separated in .env). 'direct' requires ecosystem CORS support. | false | - |
| `BASE_PATH` | `string` | Base path for asset loading. Used for sub-path deployments. | false | / |
| `DELEGATE_TRUST_TO_BACKEND` | `boolean` | Delegate trust evaluation to the backend AuthZEN proxy. Setting false is only allowed in development mode. | false | - |
| `DID_KEY_VERSION` | `string` | DID key version format (e.g. jwk_jcs-pub). | false | jwk_jcs-pub |
| `DISPLAY_ISSUANCE_WARNINGS` | `boolean` | Display the issuance warnings popup. | false | - |
| `FOLD_EVENT_HISTORY_AFTER_SECONDS` | `integer` | Fold history events older than this many seconds (default 30 days). | false | - |
| `I18N_WALLET_NAME_OVERRIDE` | `string` | Overrides translations of common.walletName. | false | - |
| `LOG_LEVEL` | `string` | Browser console log level. WARNING: 'debug' may include sensitive data (JWTs/keys). | false | info |
| `MULTI_LANGUAGE_DISPLAY` | `boolean` | Enable multi-language credential display. Empty is treated as false. | false | - |
| `OHTTP_KEY_CONFIG` | `string` | URL of the OHTTP key config endpoint. | false | - |
| `OHTTP_RELAY` | `string` | URL of the OHTTP relay endpoint. | false | - |
| `OPENID4VCI_MAX_ACCEPTED_BATCH_SIZE` | `integer` | Maximum accepted batch size during an OpenID4VCI flow. | false | - |
| `OPENID4VCI_PROOF_TYPE_PRECEDENCE` | `array` | Proof type precedence for OID4VCI. | false | - |
| `OPENID4VCI_REDIRECT_URI` | `string` | Redirect URI after authentication/token request at the authorization server in the OID4VCI flow. | false | - |
| `OPENID4VCI_TRANSACTION_ID_LIFETIME_IN_SECONDS` | `integer` | Lifetime in seconds of transaction ID. | false | - |
| `OPENID4VCI_TRANSACTION_ID_POLLING_INTERVAL_IN_SECONDS` | `integer` | Polling interval in seconds for transaction ID. | false | - |
| `OPENID4VP_SAN_DNS_CHECK` | `boolean` | Verify the certificate SAN matches the response_uri in incoming OID4VP authorization requests. | false | - |
| `OPENID4VP_SAN_DNS_CHECK_SSL_CERTS` | `boolean` | Toggle SAN validation of certificates during OpenID4VP. | false | - |
| `POLICY_LINKS` | `array` | TOS/policy links. In .env: LABEL::URL,LABEL::URL. Can be left blank. | false | - |
| `PRESERVE_PRESENTATION_HISTORY` | `boolean` | Keep credentials in presentation history even after they are deleted from the wallet. | false | - |
| `SCAN_PHYSICAL_ID_ENABLED` | `boolean` | Show the 'Scan Physical ID' entry point (native wrapper apps only) on the Add Credentials page. | false | - |
| `SHOW_PWA_INSTALL_PROMPT` | `boolean` | Show the PWA installation prompt on the login screen. | false | - |
| `STATIC_NAME` | `string` | The installation's public name. | false | - |
| `STATIC_PUBLIC_URL` | `string` | The installation's public URL. | false | - |
| `TRANSPORT_PREFERENCE` | `array` | Transport preference order; first available wins. | false | - |
| `VCT_REGISTRY_URL` | `string` | URL of the Type Metadata registry for SD-JWT VC credentials. | false | - |
| `WALLET_BACKEND_URL` | `string` | URL of the backend service. | true | - |
| `WALLET_COMPANION_INTEGRATION` | `boolean` | Enable integration with the Wallet Companion browser extension. | false | - |
| `WALLET_ENGINE_URL` | `string` | Engine URL for WebSocket transport. Falls back to WALLET_BACKEND_URL if unset. | false | - |
| `WEBAUTHN_RPID` | `string` | WebAuthn relying party ID. Must match config.webauthn.rp.id in wallet-backend-server. Use 'localhost' locally. | false | localhost |
| `WIA_ENABLED` | `boolean` | Enable Wallet Instance Attestation. | false | - |
| `WS_URL` | `string` | URL of the websocket service. | false | - |


## Startup

Used during container startup, for example to configure NGINX.

| Key | Type | Description | Required | Default |
| --- | ---- | ----------- | -------- | ------- |
| `APP_VERSION` | `string` | Application version. Defaults to the npm package version. | false | - |
| `GENERATE_SOURCEMAP` | `boolean` | Generate source maps for debugging. | false | - |
| `HOST` | `string` | IP address the dev/build server binds to. | false | 0.0.0.0 |
| `NGINX_CSP_ENFORCE_RESOURCE_HTTPS` | `boolean` | Restrict CSP resource (img) sources to https only. When false, both https and http are allowed. | false | - |
| `NGINX_ENABLE_HSTS` | `boolean` | Add the Strict-Transport-Security (HSTS) header. | false | - |
| `NGINX_SEC_HEADER_FILE` | `string` | Path to the generated nginx security-headers config file. | false | /etc/nginx/conf.d/security-headers.conf |
| `OIDC_GATE_OP_URL` | `string` | Base URL of the OIDC provider for the OIDC gate feature. Added to the CSP connect-src directive. | false | - |
| `PORT` | `integer` | Port the dev/build server runs on. | false | - |
| `WELLKNOWN_ANDROID_PACKAGE_NAMES_AND_FINGERPRINTS` | `string` | Generates .well-known/assetlinks.json for Android wrappers. In .env: <PKG>::<FINGERPRINT>,... (map of package -> fingerprints). Can be left blank. | false | - |
| `WELLKNOWN_APPLE_APPIDS` | `array` | Generates .well-known/apple-app-site-association for iOS wrappers. In .env: <APP_ID>,<APP_ID>,... Can be left blank. | false | - |
