import { useCallback, useContext, useMemo } from 'react';
import type {
	AuthZENClientConfig,
	OpenidAuthorizationServerMetadata,
	OpenidCredentialIssuerMetadata,
} from 'wallet-common';
import {
	AuthZENClient,
	OpenidAuthorizationServerMetadataSchema,
	OpenidCredentialIssuerMetadataSchema,
} from 'wallet-common';
import { BACKEND_URL, OPENID4VCI_REDIRECT_URI } from '@/config';
import SessionContext from '@/context/SessionContext';
import { useHttpClient } from '@/hooks/useHttpClient';
import { logger } from '@/logger';
import type { IOpenID4VCIHelper } from '../interfaces/IOpenID4VCIHelper';
import { getTenantFromUrlPath } from '../tenant';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export function useOpenID4VCIHelper(): IOpenID4VCIHelper {
	const httpClient = useHttpClient();
	const { api, authTokens } = useContext(SessionContext);
	const { getExternalEntity } = api;

	const authzenClient = useMemo(() => {
		const clientConfig: AuthZENClientConfig = {
			httpClient: httpClient,
			baseUrl: BACKEND_URL,
			getAuthToken: async () => (await authTokens.ensureAnonymousToken()).raw,
			tenantId: getTenantFromUrlPath() ?? 'default',
		};
		return AuthZENClient(clientConfig);
	}, [httpClient, authTokens]);

	const getCredentialIssuerMetadata = useCallback(
		async (
			credentialIssuerIdentifier: string,
			useCache?: boolean,
		): Promise<{ metadata: OpenidCredentialIssuerMetadata } | null> => {
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier, {
					resourceType: 'credential_issuer',
					useCache: useCache === true,
				});
				if (!result.ok) {
					logger.error(
						`Failed to resolve issuer metadata for ${credentialIssuerIdentifier}:`,
						result.error,
					);
					return null;
				}
				if (!result.value.decision) {
					logger.warn(
						`Issuer ${credentialIssuerIdentifier} is not trusted by the policy decision point`,
					);
				}
				const trustMetadata = result.value.context?.trust_metadata;
				if (!trustMetadata) {
					logger.error(`No trust_metadata in resolve response for ${credentialIssuerIdentifier}`);
					return null;
				}
				const parsed = OpenidCredentialIssuerMetadataSchema.safeParse(trustMetadata);
				if (!parsed.success) {
					logger.warn(
						`Schema validation failed for ${credentialIssuerIdentifier}:`,
						JSON.stringify(parsed.error.issues),
					);
					return null;
				}
				return { metadata: parsed.data };
			} catch (err) {
				logger.error(err);
				return null;
			}
		},
		[authzenClient],
	);

	// Fetches authorization server metadata via a separate backend resolver call.
	// Uses resource_type=oauth-authorization-server so the backend fetches only
	// the RFC 8414 well-known endpoint, not the credential issuer metadata.
	const getAuthorizationServerMetadata = useCallback(
		async (
			credentialIssuerIdentifier: string,
			useCache?: boolean,
			preloadedMetadata?: OpenidCredentialIssuerMetadata,
		): Promise<{ authzServerMetadata: OpenidAuthorizationServerMetadata } | null> => {
			// biome-ignore lint/complexity/noVoid: baseline: pre-existing debt. should be fixed
			void preloadedMetadata;
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier, {
					resourceType: 'oauth-authorization-server',
					useCache: useCache === true,
				});
				if (!result.ok) {
					logger.error(
						`Failed to resolve auth server metadata for ${credentialIssuerIdentifier}:`,
						result.error,
					);
					return null;
				}

				const authzMeta = result.value.context?.trust_metadata;
				if (!authzMeta) {
					logger.debug(
						`No trust_metadata in auth server resolve response for ${credentialIssuerIdentifier}`,
					);
					return null;
				}

				const parsed = OpenidAuthorizationServerMetadataSchema.safeParse(authzMeta);
				if (!parsed.success) {
					logger.warn(
						`Auth server metadata validation failed for ${credentialIssuerIdentifier}:`,
						JSON.stringify(parsed.error.issues),
					);
					return null;
				}

				return { authzServerMetadata: parsed.data };
			} catch (err) {
				logger.error(`Error fetching auth server metadata for ${credentialIssuerIdentifier}:`, err);
				return null;
			}
		},
		[authzenClient],
	);

	const getClientId = useCallback(
		async (credentialIssuerIdentifier: string) => {
			try {
				const issuerResponse = await getExternalEntity('/issuer/all', undefined, true);
				const trustedCredentialIssuers = issuerResponse.data;
				const issuer = trustedCredentialIssuers.filter(
					// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
					// biome-ignore lint/suspicious/noShadow: baseline: pre-existing debt. should be fixed
					(issuer: any) => issuer.credentialIssuerIdentifier === credentialIssuerIdentifier,
				)[0];
				if (issuer) {
					return { client_id: issuer.clientId };
				}

				return { client_id: OPENID4VCI_REDIRECT_URI };
			} catch (err) {
				logger.debug(
					// biome-ignore lint/style/useTemplate: baseline: pre-existing debt. should be fixed
					'Could not get client_id for issuer ' + credentialIssuerIdentifier + ' Details:',
				);
				logger.error(err);
				return null;
			}
		},
		[getExternalEntity],
	);

	const fetchIssuerMetadataAndCertificates = useCallback(
		async (
			getIssuers: () => Promise<Record<string, unknown>[]>,
			shouldUseCache: boolean,
			onIssuerMetadataResolved?: (
				issuerIdentifier: string,
				metadata: OpenidCredentialIssuerMetadata,
			) => void,
		) => {
			const issuerEntities = await getIssuers().catch(() => []);

			await Promise.allSettled(
				issuerEntities
					// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
					.filter((entity: any) => entity.credentialIssuerIdentifier)
					// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
					.map(async (entity: any) => {
						const metadataResult = await getCredentialIssuerMetadata(
							entity.credentialIssuerIdentifier,
							shouldUseCache,
						);
						const metadata = metadataResult?.metadata;
						if (!metadata) return;

						onIssuerMetadataResolved?.(entity.credentialIssuerIdentifier, metadata);

						const logoUris: string[] = [];
						// biome-ignore lint/complexity/noForEach: baseline: pre-existing debt. should be fixed
						// biome-ignore lint/suspicious/useIterableCallbackReturn: baseline: pre-existing debt. should be fixed
						metadata.display?.forEach((d) => d.logo?.uri && logoUris.push(d.logo.uri));
						// biome-ignore lint/complexity/noForEach: baseline: pre-existing debt. should be fixed
						// biome-ignore lint/suspicious/useIterableCallbackReturn: baseline: pre-existing debt. should be fixed
						Object.values(metadata.credential_configurations_supported || {}).forEach(
							// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
							(config: any) =>
								// biome-ignore lint/complexity/noForEach: baseline: pre-existing debt. should be fixed
								// biome-ignore lint/suspicious/useIterableCallbackReturn: baseline: pre-existing debt. should be fixed
								config.display?.forEach((d) => d.logo?.uri && logoUris.push(d.logo.uri)),
						);

						// biome-ignore lint/complexity/noForEach: baseline: pre-existing debt. should be fixed
						logoUris
							.filter((uri) => uri.startsWith('http'))
							// biome-ignore lint/suspicious/useIterableCallbackReturn: baseline: pre-existing debt. should be fixed
							.forEach((uri) =>
								httpClient.get(uri, {}, { useCache: shouldUseCache }).catch(logger.error),
							);
					}),
			);
		},
		[getCredentialIssuerMetadata, httpClient],
	);

	return useMemo(
		() => ({
			getClientId,
			getAuthorizationServerMetadata,
			getCredentialIssuerMetadata,
			fetchIssuerMetadataAndCertificates,
		}),
		[
			getClientId,
			getAuthorizationServerMetadata,
			getCredentialIssuerMetadata,
			fetchIssuerMetadataAndCertificates,
		],
	);
}
