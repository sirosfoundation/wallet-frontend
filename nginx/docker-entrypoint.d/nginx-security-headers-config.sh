#!/usr/bin/env sh
set -e

# Available options from environment variables:
# - OUTPUT_FILE (Default: "/etc/nginx/conf.d/security-headers.conf")
# - WS_URL
# - WALLET_BACKEND_URL
# - OHTTP_KEY_CONFIG
# - OHTTP_RELAY
# - VCT_REGISTRY_URL
# - ENFORCE_RESOURCE_HTTPS ("true" or "false". Default: "false")
# - ENABLE_HSTS ("true" or "false". Default: "false")

# -------------------------------------------------------------------------------------------------
if [ -z "${OUTPUT_FILE}" ]; then
	OUTPUT_FILE="/etc/nginx/conf.d/security-headers.conf"
fi

CONNECT_SRC="'self'"

# -------------------------------------------------------------------------------------------------
if [ -n "${WS_URL}" ]; then
	CONNECT_SRC="${CONNECT_SRC} ${WS_URL}"
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

if [ "${ENFORCE_RESOURCE_HTTPS}" = "true" ]; then
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
cat > "${OUTPUT_FILE}" <<EOF
add_header Content-Security-Policy "${CSP}" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Permitted-Cross-Domain-Policies "none" always;
add_header Permissions-Policy "microphone=(), geolocation=(), payment=()" always;
EOF

# -------------------------------------------------------------------------------------------------
if [ "${ENABLE_HSTS}" = "true" ]; then
	RESOURCE_SCHEME_SRC="https:"
	echo 'add_header Strict-Transport-Security "max-age=63072000" always;' >> "${OUTPUT_FILE}"
fi

# -------------------------------------------------------------------------------------------------
echo "Generated security headers: ${OUTPUT_FILE}"
