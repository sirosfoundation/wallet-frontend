#!/usr/bin/env sh
set -e

# Available options from environment variables:
# - WS_URL
# - WALLET_BACKEND_URL
# - OHTTP_KEY_CONFIG
# - OHTTP_RELAY
# - VCT_REGISTRY_URL

# -------------------------------------------------------------------------------------------------
OUTPUT_FILE="/etc/nginx/conf.d/security-headers.conf"
#
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

# -------------------------------------------------------------------------------------------------
# Content Security Policy configuration
CSP="default-src 'self'; \
script-src 'self'; \
style-src 'self'; \
font-src 'self' data: https:; \
img-src 'self' data: https:; \
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
EOF

# -------------------------------------------------------------------------------------------------
echo "Generated security headers: ${OUTPUT_FILE}"
