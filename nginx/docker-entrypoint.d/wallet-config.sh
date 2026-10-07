#!/usr/bin/env sh

wfcg \
	--schema-dir /usr/share/nginx/.schemas \
	--source-dir /usr/share/nginx/branding \
	--dest-dir /usr/share/nginx/html

nginx -g "daemon off;"
