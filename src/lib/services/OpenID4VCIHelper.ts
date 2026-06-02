import { IOpenID4VCIHelper } from "../interfaces/IOpenID4VCIHelper";
import { base64url, importX509, jwtVerify } from "jose";
import { getPublicKeyFromB64Cert } from "../utils/pki";
import { useHttpProxy } from "./HttpProxy/HttpProxy";
import { useCallback, useContext, useMemo } from "react";
import SessionContext from "@/context/SessionContext";
import { OpenidAuthorizationServerMetadataSchema, OpenidCredentialIssuerMetadataSchema } from 'wallet-common';
import type { OpenidAuthorizationServerMetadata, OpenidCredentialIssuerMetadata } from 'wallet-common';
import { OPENID4VCI_REDIRECT_URI } from "@/config";
import { logger } from '@/logger';

export function useOpenID4VCIHelper(): IOpenID4VCIHelper {
	const httpProxy = useHttpProxy();
	const { api } = useContext(SessionContext);
	const { getExternalEntity } = api;

	const fetchAndParseWithSchema = useCallback(
		async function fetchAndParseWithSchema<T>(path: string, schema: any, useCache: boolean = true, cacheOnError: boolean = false): Promise<T> {
			try {
				const response = await httpProxy.get(path, {}, { useCache: useCache !== undefined ? useCache : true, cacheOnError });
				if (!response) throw new Error("Couldn't get response");

				const result = schema.safeParse(response.data);

				if (!result.success) {
					logger.warn(`Schema validation failed for ${path}:`, JSON.stringify(result.error.issues));
					throw new Error("Invalid response schema");
				}

				return result.data;
			} catch (err) {
				logger.error(`Error fetching from ${path}:`, err);
				throw new Error(`Couldn't get data from ${path}`);
			}
		}, [httpProxy])

	const getCredentialIssuerMetadata = useCallback(
		async (credentialIssuerIdentifier: string, useCache?: boolean): Promise<{ metadata: OpenidCredentialIssuerMetadata } | null> => {
			void useCache; // cache control is handled server-side by the resolver
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier);
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
				return { metadata };
			}
			catch (err) {
				logger.error(err);
				return null;
			}
		},
		[fetchAndParseWithSchema]
	);

	// Fetches authorization server metadata via a separate backend resolver call.
	// Uses resource_type=oauth-authorization-server so the backend fetches only
	// the RFC 8414 well-known endpoint, not the credential issuer metadata.
	const getAuthorizationServerMetadata = useCallback(
		async (credentialIssuerIdentifier: string, useCache?: boolean, preloadedMetadata?: OpenidCredentialIssuerMetadata): Promise<{ authzServerMetadata: OpenidAuthorizationServerMetadata } | null> => {
			void useCache;
			void preloadedMetadata;
			try {
				const result = await authzenClient.resolve(credentialIssuerIdentifier, {
					resourceType: 'oauth-authorization-server',
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

					logoUris.forEach(uri => httpProxy.get(uri, {}, { useCache: shouldUseCache }).catch(logger.error));
				} catch (error) {
					logger.error(`Failed to fetch metadata for ${entity.credentialIssuerIdentifier}:`, error);
				}
			});
		},
		[getCredentialIssuerMetadata, getMdocIacas, httpProxy, getExternalEntity]
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
