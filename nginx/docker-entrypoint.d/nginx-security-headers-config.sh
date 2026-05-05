#!/usr/bin/env sh
set -e

# Available options from environment variables:
# - NGINX_SEC_HEADER_FILE (Default: "/etc/nginx/conf.d/security-headers.conf")
# - WS_URL
# - WALLET_ENGINE_URL
# - WALLET_BACKEND_URL
# - OHTTP_KEY_CONFIG
# - OHTTP_RELAY
# - VCT_REGISTRY_URL
# - NGINX_CSP_ENFORCE_RESOURCE_HTTPS ("true" or "false". Default: "false")
# - NGINX_ENABLE_HSTS ("true" or "false". Default: "false")

# -------------------------------------------------------------------------------------------------
if [ -z "${NGINX_SEC_HEADER_FILE}" ]; then
	NGINX_SEC_HEADER_FILE="/etc/nginx/conf.d/security-headers.conf"
fi

CONNECT_SRC="'self'"

# -------------------------------------------------------------------------------------------------
if [ -n "${WS_URL}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${WS_URL}"
	CONNECT_SRC="${CONNECT_SRC} $(echo "${WS_URL}" | sed 's|^wss://|https://|;s|^ws://|http://|')"
fi

if [ -n "${WALLET_ENGINE_URL}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${WALLET_ENGINE_URL}"
	CONNECT_SRC="${CONNECT_SRC} $(echo "${WALLET_ENGINE_URL}" | sed 's|^https://|wss://|;s|^http://|ws://|')"
fi

if [ -n "${WALLET_BACKEND_URL}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${WALLET_BACKEND_URL}"
fi

if [ -n "${OHTTP_KEY_CONFIG}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${OHTTP_KEY_CONFIG}"
fi

if [ -n "${OHTTP_RELAY}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${OHTTP_RELAY}"
fi

if [ -n "${VCT_REGISTRY_URL}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${VCT_REGISTRY_URL}"
fi

if [ "${NGINX_CSP_ENFORCE_RESOURCE_HTTPS}" = "true" ]; then
	RESOURCE_SCHEME_SRC="https:"
else
	RESOURCE_SCHEME_SRC="https: http:"
fi

# -------------------------------------------------------------------------------------------------
# Content Security Policy configuration
CSP="default-src 'self'; \
script-src 'self'; \
style-src 'self'; \
font-src 'self' data:; \
img-src 'self' data: ${RESOURCE_SCHEME_SRC}; \
connect-src ${CONNECT_SRC}; \
frame-ancestors 'none'; \
base-uri 'self'; \
form-action 'self'"

# -------------------------------------------------------------------------------------------------
cat > "${NGINX_SEC_HEADER_FILE}" <<EOF
add_header Content-Security-Policy "${CSP}" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Permitted-Cross-Domain-Policies "none" always;
add_header Permissions-Policy "microphone=(), geolocation=(), payment=()" always;
EOF

# -------------------------------------------------------------------------------------------------
if [ "${NGINX_ENABLE_HSTS}" = "true" ]; then
	echo 'add_header Strict-Transport-Security "max-age=63072000" always;' >> "${NGINX_SEC_HEADER_FILE}"
fi

# -------------------------------------------------------------------------------------------------
echo "Generated security headers: ${NGINX_SEC_HEADER_FILE}"
