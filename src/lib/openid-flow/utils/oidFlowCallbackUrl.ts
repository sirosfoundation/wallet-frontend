import { OIDFlowCallbackURL } from '../types';

/**
 * Parses a callback URL to determine the OpenID flow type and relevant parameters.
 */
export function parseOIDFlowCallbackUrl(url: URL): OIDFlowCallbackURL {
	// credential offer
	if (
		url.protocol === 'openid-credential-offer:' ||
		url.searchParams.get('credential_offer') ||
		url.searchParams.get('credential_offer_uri')
	) return {
		protocol: 'oid4vci',
		type: 'credential_offer',
		url,
	};

	// authorization code
	if (url.searchParams.get('code')) return {
		protocol: 'oid4vci',
		type: 'authorization_code',
		url,
	};

	// authorization request
	if (
		url.searchParams.get('client_id') &&
		url.searchParams.get('request_uri')
	) return {
		protocol: 'oid4vp',
		type: 'presentation_request',
		url,
	};

	// authorization error
	if (
		url.searchParams.get('state') &&
		url.searchParams.get('error')
	) return {
		protocol: 'unknown',
		type: 'authorization_error',
		url,
	};

	return {
		protocol: 'unknown',
		type: 'unknown',
		url,
	};
}
