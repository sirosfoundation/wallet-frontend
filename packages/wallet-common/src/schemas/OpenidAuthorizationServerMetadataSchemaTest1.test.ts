// biome-ignore lint/style/useNodejsImportProtocol: baseline: pre-existing debt. should be fixed
import assert from 'assert';
import { describe, it } from 'vitest';
import { OpenidAuthorizationServerMetadataSchema } from './OpenidAuthorizationServerMetadataSchema';

const metadata = {
	issuer: 'https://wallet.a-sit.at/m6',
	authorization_endpoint: 'https://wallet.a-sit.at/m6/authorize',
	pushed_authorization_request_endpoint: 'https://wallet.a-sit.at/m6/par',
	require_pushed_authorization_requests: true,
	token_endpoint: 'https://wallet.a-sit.at/m6/token',
	token_endpoint_auth_methods_supported: ['attest_jwt_client_auth'],
	jwks_uri: 'https://example.com/jwks',
};

describe('OpenidCredentialIssuerMetadataSchemaValera', () => {
	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	it("should successfully parse Valera issuer's metadata", async () => {
		const res = OpenidAuthorizationServerMetadataSchema.safeParse(metadata);
		if (res.error) {
			// biome-ignore lint/suspicious/noConsole: baseline: pre-existing debt. should be fixed
			console.dir(res.error, { depth: null });
		}
		assert(res.success === true);
	});
});
