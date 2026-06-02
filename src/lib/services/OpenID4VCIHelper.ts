import { IOpenID4VCIHelper } from "../interfaces/IOpenID4VCIHelper";
import { useCallback, useContext, useMemo } from "react";
import SessionContext from "@/context/SessionContext";
import { AuthZENClient, OpenidAuthorizationServerMetadataSchema, OpenidCredentialIssuerMetadataSchema } from 'wallet-common';
import type { AuthZENClientConfig, OpenidAuthorizationServerMetadata, OpenidCredentialIssuerMetadata } from 'wallet-common';
import { BACKEND_URL, OPENID4VCI_REDIRECT_URI } from "@/config";
import { logger } from '@/logger';
import { getTenantFromUrlPath } from "../tenant";
import { useHttpClient } from "@/hooks/useHttpClient";

export function useOpenID4VCIHelper(): IOpenID4VCIHelper {
	const httpClient = useHttpClient();
	const { api } = useContext(SessionContext);
	const { getExternalEntity } = api;

	const authzenClient = useMemo(() => {
		const clientConfig: AuthZENClientConfig = {
			httpClient: httpClient,
			baseUrl: BACKEND_URL,
			getAuthToken: () => api.getAppToken() ?? '',
			tenantId: getTenantFromUrlPath() ?? 'default',
		};
		return AuthZENClient(clientConfig);
	}, [httpClient, api]);

	const getCredentialIssuerMetadata = useCallback(
		async (credentialIssuerIdentifier: string, useCache?: boolean): Promise<{ metadata: OpenidCredentialIssuerMetadata } | null> => {
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier, {
					resourceType: 'credential_issuer',
					useCache: useCache === true
				});
				if (!result.ok) {
					logger.error(`Failed to resolve issuer metadata for ${credentialIssuerIdentifier}:`, result.error);
					return null;
				}
				if (!result.value.decision) {
					logger.warn(`Issuer ${credentialIssuerIdentifier} is not trusted by the policy decision point`);
				}
				const trustMetadata = result.value.context?.trust_metadata;
				if (!trustMetadata) {
					logger.error(`No trust_metadata in resolve response for ${credentialIssuerIdentifier}`);
					return null;
				}
				const parsed = OpenidCredentialIssuerMetadataSchema.safeParse(trustMetadata);
				if (!parsed.success) {
					logger.warn(`Schema validation failed for ${credentialIssuerIdentifier}:`, JSON.stringify(parsed.error.issues));
					return null;
				}
				return { metadata: parsed.data };
			}
			catch (err) {
				logger.error(err);
				return null;
			}
		},
		[authzenClient]
	);

	// Fetches authorization server metadata via a separate backend resolver call.
	// Uses resource_type=oauth-authorization-server so the backend fetches only
	// the RFC 8414 well-known endpoint, not the credential issuer metadata.
	const getAuthorizationServerMetadata = useCallback(
		async (credentialIssuerIdentifier: string, useCache?: boolean, preloadedMetadata?: OpenidCredentialIssuerMetadata): Promise<{ authzServerMetadata: OpenidAuthorizationServerMetadata } | null> => {
			void preloadedMetadata;
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier, {
					resourceType: 'oauth-authorization-server',
					useCache: useCache === true
				});
				if (!result.ok) {
					logger.error(`Failed to resolve auth server metadata for ${credentialIssuerIdentifier}:`, result.error);
					return null;
				}

				const authzMeta = result.value.context?.trust_metadata;
				if (!authzMeta) {
					logger.debug(`No trust_metadata in auth server resolve response for ${credentialIssuerIdentifier}`);
					return null;
				}

				const parsed = OpenidAuthorizationServerMetadataSchema.safeParse(authzMeta);
				if (!parsed.success) {
					logger.warn(`Auth server metadata validation failed for ${credentialIssuerIdentifier}:`, JSON.stringify(parsed.error.issues));
					return null;
				}

				return { authzServerMetadata: parsed.data };
			} catch (err) {
				logger.error(`Error fetching auth server metadata for ${credentialIssuerIdentifier}:`, err);
				return null;
			}
		},
		[authzenClient]
	);

	const getClientId = useCallback(
		async (credentialIssuerIdentifier: string) => {

			try {
				const issuerResponse = await getExternalEntity('/issuer/all', undefined, true);
				const trustedCredentialIssuers = issuerResponse.data;
				const issuer = trustedCredentialIssuers.filter((issuer: any) => issuer.credentialIssuerIdentifier === credentialIssuerIdentifier)[0];
				if (issuer) {
					return { client_id: issuer.clientId };
				}

					return { client_id: OPENID4VCI_REDIRECT_URI };
			}
			catch (err) {
				logger.debug("Could not get client_id for issuer " + credentialIssuerIdentifier + " Details:");
				logger.error(err);
				return null;
			}
		},
		[getExternalEntity]
	);

	const fetchIssuerMetadataAndCertificates = useCallback(
		async (
			getIssuers: () => Promise<Record<string, unknown>[]>,
			shouldUseCache: boolean,
			onIssuerMetadataResolved?: (issuerIdentifier: string, metadata: OpenidCredentialIssuerMetadata) => void
		) => {
			const issuerEntities = await getIssuers().catch(() => []);
			issuerEntities.forEach(async (entity: any) => {
				if (!entity.credentialIssuerIdentifier) return;

				try {
					const metadataResult = await getCredentialIssuerMetadata(entity.credentialIssuerIdentifier, shouldUseCache);
					const metadata = metadataResult?.metadata;
					if (!metadata) return;

					// Note: authorization server metadata is NOT fetched during preload.
					// It is fetched on-demand when the OID4VCI flow actually needs it
					// (e.g. for token exchange). Fetching it here would cause unexpected
					// requests to issuers before any flow has started.

					// Call a callback to update state when metadata resolves.
					onIssuerMetadataResolved?.(entity.credentialIssuerIdentifier, metadata);

					const logoUris = metadata.display?.map(d => d.logo?.uri).filter(Boolean) || [];
					Object.values(metadata.credential_configurations_supported || {}).forEach((config: any) => {
						config.display?.forEach(d => d.logo?.uri && logoUris.push(d.logo.uri));
					});

					logoUris.forEach(uri => httpClient.get(uri, {}, { useCache: shouldUseCache }).catch(logger.error));
				} catch (error) {
					logger.error(`Failed to fetch metadata for ${entity.credentialIssuerIdentifier}:`, error);
				}
			});
		},
		[getCredentialIssuerMetadata, httpClient]
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
		]
	);
}
