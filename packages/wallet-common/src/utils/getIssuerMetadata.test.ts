import { assert, describe, it } from 'vitest';
import type { IAuthZENClient } from '../authzen/AuthZENClient';
import { AuthZENErrorCode } from '../authzen/types';
import { err, ok } from '../core/Result';
import { CredentialParsingError } from '../error';
import type { HttpClient } from '../interfaces';
import type { MetadataWarning } from '../types';
import { getIssuerMetadata } from '../utils/getIssuerMetadata';

describe('getIssuerMetadata', () => {
	it('should warn if issuer metadata fetch fails', async () => {
		const warnings: MetadataWarning[] = [];

		const httpClient: HttpClient = {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			get: async (url: string) => {
				if (url.includes('.well-known/openid-credential-issuer')) {
					return { status: 400 };
				}
				throw new Error('Unexpected call');
			},
		};

		const result = await getIssuerMetadata(httpClient, 'https://example.com', warnings);

		assert(result.metadata === null);
		assert(warnings.some((w) => w.code === CredentialParsingError.FailFetchIssuerMetadata));
	});

	it('should strip trailing slash from well-known URL', async () => {
		const warnings: MetadataWarning[] = [];
		let requestedUrl = '';

		const httpClient: HttpClient = {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			get: async (url: string) => {
				requestedUrl = url;
				return { status: 400 };
			},
		};

		await getIssuerMetadata(httpClient, 'https://example.com/issuer/', warnings);

		assert(
			requestedUrl === 'https://example.com/.well-known/openid-credential-issuer/issuer',
			`Expected trailing slash stripped, got: ${requestedUrl}`,
		);
	});

	it('should construct RFC 8615 well-known URL with path', async () => {
		const warnings: MetadataWarning[] = [];
		let requestedUrl = '';

		const httpClient: HttpClient = {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			get: async (url: string) => {
				requestedUrl = url;
				return { status: 400 };
			},
		};

		await getIssuerMetadata(httpClient, 'https://example.com/tenant/1', warnings);

		assert(
			requestedUrl === 'https://example.com/.well-known/openid-credential-issuer/tenant/1',
			`Expected RFC 8615 path insertion, got: ${requestedUrl}`,
		);
	});

	it('should warn if issuer metadata has invalid schema', async () => {
		const warnings: MetadataWarning[] = [];

		const httpClient: HttpClient = {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			get: async (url: string) => {
				if (url.includes('.well-known/openid-credential-issuer')) {
					return {
						status: 200,
						data: {
							invalid_field: true, // missing required schema fields
						},
					};
				}
				throw new Error('Unexpected call');
			},
		};

		const result = await getIssuerMetadata(httpClient, 'https://example.com', warnings);
		assert(result.metadata === null);
		assert(warnings.some((w) => w.code === CredentialParsingError.FailSchemaIssuerMetadata));
	});

	describe('resolve-based path', () => {
		const dummyHttpClient: HttpClient = {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			get: async () => {
				throw new Error('should not be called when authzenClient is provided');
			},
		};

		function mockAuthzenClient(resolveResult: ReturnType<typeof ok | typeof err>): IAuthZENClient {
			return {
				resolve: async () => resolveResult,
				// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
				evaluate: async () => {
					throw new Error('not implemented');
				},
				// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
				evaluateVerifier: async () => {
					throw new Error('not implemented');
				},
				// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
				evaluateIssuer: async () => {
					throw new Error('not implemented');
				},
			} as unknown as IAuthZENClient;
		}

		it('should return metadata from resolve response', async () => {
			const warnings: MetadataWarning[] = [];
			const client = mockAuthzenClient(
				ok({
					decision: true,
					context: {
						trust_metadata: {
							credential_issuer: 'https://issuer.example.com',
							credential_endpoint: 'https://issuer.example.com/credential',
							credential_configurations_supported: {},
						},
					},
				}),
			);

			const result = await getIssuerMetadata(
				dummyHttpClient,
				'https://issuer.example.com',
				warnings,
				true,
				client,
			);
			assert(result.metadata !== null);
			// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
			assert(result.metadata!.credential_issuer === 'https://issuer.example.com');
			assert(warnings.length === 0);
		});

		it('should warn when resolve returns error', async () => {
			const warnings: MetadataWarning[] = [];
			const client = mockAuthzenClient(
				err({
					error: AuthZENErrorCode.NETWORK_ERROR,
					details: 'timeout',
				}),
			);

			const result = await getIssuerMetadata(
				dummyHttpClient,
				'https://issuer.example.com',
				warnings,
				true,
				client,
			);
			assert(result.metadata === null);
			assert(warnings.some((w) => w.code === CredentialParsingError.FailFetchIssuerMetadata));
		});

		it('should warn when resolve returns no trust_metadata', async () => {
			const warnings: MetadataWarning[] = [];
			const client = mockAuthzenClient(
				ok({
					decision: true,
					context: {},
				}),
			);

			const result = await getIssuerMetadata(
				dummyHttpClient,
				'https://issuer.example.com',
				warnings,
				true,
				client,
			);
			assert(result.metadata === null);
			assert(warnings.some((w) => w.code === CredentialParsingError.FailFetchIssuerMetadata));
		});

		it('should warn when trust_metadata fails schema validation', async () => {
			const warnings: MetadataWarning[] = [];
			const client = mockAuthzenClient(
				ok({
					decision: true,
					context: {
						trust_metadata: { invalid: true },
					},
				}),
			);

			const result = await getIssuerMetadata(
				dummyHttpClient,
				'https://issuer.example.com',
				warnings,
				true,
				client,
			);
			assert(result.metadata === null);
			assert(warnings.some((w) => w.code === CredentialParsingError.FailSchemaIssuerMetadata));
		});
	});
});
