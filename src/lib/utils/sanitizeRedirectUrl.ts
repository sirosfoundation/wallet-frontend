/**
 * We only allow navigating to http and https URLs.
 *
 * If we need to support other URL schemes, they should be added here.
 */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https']);

/**
 * Sanitize a redirect URL to ensure it uses an allowed scheme.
 */
export function sanitizeRedirectUrl(url: string | URL): string {
	url = typeof url === 'string' ? new URL(url) : url;

	const protocol = url.protocol.endsWith(':') ? url.protocol.slice(0, -1) : url.protocol;

	if (!ALLOWED_URL_SCHEMES.has(protocol)) {
		throw new Error(`Prohibited URL scheme "${protocol}" in redirect URL "${url.toString()}"`);
	}

	return url.toString();
}
