/**
 * Hybrid OID4VP Flow Hook
 *
 * This hook provides a unified interface for verifiable presentation flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useOIDFlowTransportSafe } from '@/context/OIDFlowTransportContext';
import SessionContext from '@/context/SessionContext';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import { matchCredentials } from '@/services/CredentialMatchingService';
import type {
	OID4VPFlowResult,
	OID4VPSelectedCredential,
	OID4VPVerifierInfo,
} from '@/lib/openid-flow/types/OID4VPTypes';
import type { OIDFlowActiveTransportType, OIDFlowProgressEvent } from '@/lib/openid-flow/types/OIDFlowTypes';
import { DcqlQuery } from 'dcql';
import { getLeastUsedCredentialInstance } from '@/lib/services/CredentialBatchHelper';
import { applySelectiveDisclosure } from '@/lib/sd-jwt/sd-jwt';
import { OIDFlowError } from '@/lib/openid-flow/errors';
import { useOIDFlowSignHandler } from './useOIDFlowSignHandler';
import { DCAPIRequest, DCAPISession } from '@/lib/openid-flow/platforms/dc-api';
import { LocalStorageKeystore } from '@/services/LocalStorageKeystore';
import { BackendApi } from '@/api';
import { parseClientIdScheme, KeyMaterial } from 'wallet-common';
import { logger } from '@/logger';
import { ConformantCredentials } from '@/components/flows/PresentCredentialsFlow';

export interface UseOID4VPFlowOptions {
	/**
	 * Called when flow progress updates
	 */
	onProgress?: (event: OIDFlowProgressEvent) => void;
	/**
	 * Called when an error occurs
	 */
	onError?: (error: Error) => void;
	/**
	 * Callback to show credential selection UI
	 */
	onCredentialSelection?: (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery: DcqlQuery.Input,
		conformantCredentialsMap: ConformantCredentials,
	) => Promise<Map<string, number>>;
}

export interface UseOID4VPFlowReturn {
	/**
	 * Start an OID4VP flow with an authorization request URI
	 */
	handleAuthorizationRequest: (
		authorizationRequestUrl: URL
	) => Promise<OID4VPFlowResult>;
	/**
	 * Handle credential selection by showing the configured UI and returning the user's selection
	 */
	handleCredentialSelection: (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery?: DcqlQuery.Input,
		preMatchedCredentials?: Map<string, { credentials: number[]; requestedFields: Array<{ name?: string; path?: string[] }> }>
	) => Promise<OID4VPFlowResult>;
	/**
	 * Send authorization response with selected credentials
	 */
	sendAuthorizationResponse: (
		selectedCredentials: OID4VPSelectedCredential[]
	) => Promise<OID4VPFlowResult>;
	/**
	 * Current transport type being used
	 */
	transportType: OIDFlowActiveTransportType;
	/**
	 * Whether a flow is currently in progress
	 */
	isLoading: boolean;
	/**
	 * Last error if any
	 */
	error: Error | null;
	/**
	 * Clear the last error
	 */
	clearError: () => void;
	/**
	 * Handle DC API request - parse URL, match credentials, store session
	 */
	handleDCAPIRequest: (
		request: DCAPIRequest,
		selectedCredentialIDs: string[],
		verifiedOrigin: string,
	) => Promise<OID4VPFlowResult>;
	/**
	 * Send DC API response - sign, record history, send via session
	 */
	sendDCAPIResponse: (session: DCAPISession, credentials: OID4VPSelectedCredential[]) => Promise<OID4VPFlowResult>;
}

/**
 * Hook for verifiable presentation flows with transport abstraction
 *
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VP implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VPFlow(options: UseOID4VPFlowOptions = {}): UseOID4VPFlowReturn {
	const { onProgress, onError } = options;

	const transportContext = useOIDFlowTransportSafe();
	const { keystore, api } = useContext(SessionContext);
	const { vcEntityList } = useContext(CredentialsContext);
	const { openID4VP } = useContext(OpenID4VPContext);
	const { signPresentation } = useOIDFlowSignHandler();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const transportType = transportContext?.transportType ?? 'none';
	const transport = transportContext?.transport;

	const clearError = useCallback(() => {
		setError(null);
		transportContext?.clearError?.();
	}, [transportContext]);

	const vcEntityListRef = useRef(vcEntityList);
	const credentialsReadyResolvers = useRef<((list: ExtendedVcEntity[]) => void)[]>([]);
	const verifierAudienceRef = useRef<string>('');

	useEffect(() => {
		vcEntityListRef.current = vcEntityList;
		if (vcEntityList != null && credentialsReadyResolvers.current.length > 0) {
			for (const resolve of credentialsReadyResolvers.current) {
				resolve(vcEntityList);
			}
			credentialsReadyResolvers.current = [];
		}
	}, [vcEntityList]);

	/**
	 * Wait for credentials to be loaded before proceeding with flow steps that require them
	 */
	const waitForCredentials = useCallback((): Promise<ExtendedVcEntity[]> => {
		const current = vcEntityListRef.current;
		if (current != null) {
			return Promise.resolve(current);
		}
		return new Promise((resolve) => {
			credentialsReadyResolvers.current.push(resolve);
		});
	}, []);

	/**
	 * Handle authorization request using the appropriate transport
	 */
	const handleAuthorizationRequest = useCallback(async (
		authorizationRequestUrl: URL
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: delegate to backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};
				const unsubscribeError = onError
					? transport.onError(onError)
					: () => {};

				try {
					const requestUriRef = authorizationRequestUrl.searchParams.get('request_uri');
					const clientId = authorizationRequestUrl.searchParams.get('client_id');
					verifierAudienceRef.current = clientId ?? '';
					const result = await transport.startOID4VPFlow({
						requestUriRef,
						clientId,
					});

					if (!result.success) {
						throw new OIDFlowError(result.error);
					}

					return result;
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VP) {
				try {
					const credentials = await waitForCredentials();
					const result = await openID4VP.handleAuthorizationRequest(
						authorizationRequestUrl.toString(),
						credentials,
					);

					verifierAudienceRef.current = authorizationRequestUrl.searchParams.get('client_id') ?? '';

					// Check for error response
					if ('error' in result) {
						throw new OIDFlowError({ code: result.error, message: 'Authorization request failed' });
					}

					// Convert to OID4VPFlowResult format
					// The conformantCredentialsMap is a Map<string, any>
					const conformantCredentials = result.conformantCredentialsMap;

					return {
						success: true,
						conformantCredentials,
						verifierInfo: {
							name: result.verifierDomainName,
							purpose: result.verifierPurpose,
							domain: result.verifierDomainName,
						},
						transactionData: result.parsedTransactionData?.map(td => ({
							type: 'transaction',
							description: ('description' in (td.parsed ?? {}) ? (td.parsed as any).description : null) || JSON.stringify(td.parsed || td).slice(0, 100),
							data: td,
						})),
					};
				} catch (err) {
					throw err;
				}
			}

			// No transport available
			throw new OIDFlowError({ code: 'NO_TRANSPORT', message: 'No transport available for verifiable presentation' });

		} catch (err) {
			const error = err instanceof OIDFlowError ? err : new OIDFlowError({ code: 'FLOW_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VP, onProgress, onError, waitForCredentials]);

	/**
	 * Handle credential selection by showing the configured UI and returning the user's selection
	 */
	const handleCredentialSelection = useCallback(async (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery?: DcqlQuery.Input,
		preMatchedCredentials?: Map<string, { credentials: number[]; requestedFields: Array<{ name?: string; path?: string[] }> }>
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			if (!options.onCredentialSelection) throw new OIDFlowError({
				code: 'NO_CREDENTIAL_SELECTION_POPUP',
				message: 'No credential selection popup configured'
			});

			const credentials = await waitForCredentials();

			// TODO: Remove preMatchedCredentials once http_proxy flow fully migrated to use
			// matchCredentials in the hook instead of backend matching in wallet-common
			let conformantCredentialsMap: ConformantCredentials = new Map();

			if (preMatchedCredentials) {
				conformantCredentialsMap = new Map(preMatchedCredentials);
			} else if (dcqlQuery) {
				const { matches, no_match_reason, code } = matchCredentials(credentials, dcqlQuery);

				if (matches.length === 0) {
					throw new OIDFlowError({ code: code ?? 'NO_MATCHING_CREDENTIALS', message: no_match_reason || 'No matching credentials' });
				}

				conformantCredentialsMap = new Map(buildConformantCredentialsMap(matches, dcqlQuery));
			} else {
				throw new OIDFlowError({ code: 'NO_DCQL_QUERY_OR_PREMATCHED_CREDENTIALS', message: 'No dcqlQuery or preMatchedCredentials provided' });
			}

			if (conformantCredentialsMap.size === 0) {
				throw new OIDFlowError({ code: 'INSUFFICIENT_CREDENTIALS', message: 'No credentials available for selection' });
			}

			// Show popup → user picks descriptorId → batchId
			const selectionMap = await options.onCredentialSelection(
				verifierInfo,
				dcqlQuery,
				conformantCredentialsMap,
			);

			// Convert to OID4VPSelectedCredential[]
			const selected: OID4VPSelectedCredential[] = [];
			for (const [descriptorId, batchId] of selectionMap.entries()) {
				// Pick least-used instance for unlinkability
				const walletState = keystore?.getCalculatedWalletState();
				if (!walletState) throw new OIDFlowError({ code: 'WALLET_STATE_UNAVAILABLE', message: 'Wallet state not available' });

				const instance = await getLeastUsedCredentialInstance(batchId, credentials, walletState);
				if (!instance) continue;

				selected.push({
					batchId,
					credentialQueryId: descriptorId,
					walletCredentialRef: String(instance.credentialId),
					credentialRaw: instance.data,
					holderKeyKid: instance.kid,
					disclosedClaims: dcqlQuery
						? dcqlQuery.credentials.find(c => c.id === descriptorId)?.claims?.map(c => c.path?.join('.')) ?? []
						: preMatchedCredentials?.get(descriptorId)?.requestedFields?.map(f => f.path?.join('.')) ?? [],
				});
			}

			return {
				success: true,
				selectedCredentials: selected,
			};
		} catch (err) {
			if (err === undefined || err === null) {
				// User cancelled the popup
				return {
					success: false,
					error: {
						code: 'USER_CANCELLED',
						message: 'User cancelled'
					}
				};
			}
			const error = err instanceof OIDFlowError ? err : new OIDFlowError({ code: 'SELECTION_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [
		keystore,
		options,
		waitForCredentials,
		onError,
	]);

	/**
	 * Send authorization response with selected credentials
	 */
	const sendAuthorizationResponse = useCallback(async (
		selectedCredentials: OID4VPSelectedCredential[]
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: continue flow on backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};

				try {
					const result = await transport.startOID4VPFlow({
						selectedCredentials,
					});

					// Record presentation history for sigCount tracking
					if (keystore) {
						await recordPresentationHistory(keystore, api, selectedCredentials, verifierAudienceRef.current);
					}

					if (!result.success) {
						throw new OIDFlowError({ code: result.error?.code || 'AUTHORIZATION_RESPONSE_FAILED', message: result.error?.message || 'Authorization response failed' });
					}

					return result;
				} finally {
					unsubscribeProgress();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VP) {
				// Convert OID4VPSelectedCredential[] to Map<string, number>
				// The existing implementation uses descriptor ID -> credential index
				const selectionMap = new Map<string, number>();

				const currentVcEntityList = await waitForCredentials();

				// Note: This assumes the credential indices match vcEntityList
				// In practice, we'd need more sophisticated matching
				selectedCredentials.forEach(cred => {
					selectionMap.set(cred.credentialQueryId, cred.batchId);
				});

				const result = await openID4VP.sendAuthorizationResponse(
					selectionMap,
					currentVcEntityList
				);

				// Check result type
				if (result && 'url' in result && result.url) {
					return {
						success: true,
						redirectUri: result.url,
					};
				}

				if (result && 'presentation_during_issuance_session' in result) {
					return {
						success: true,
						responseData: {
							presentation_during_issuance_session:
								result.presentation_during_issuance_session,
						},
					};
				}

				return {
					success: true,
				};
			}

			throw new OIDFlowError({ code: 'NO_TRANSPORT_AVAILABLE', message: 'No transport available' });

		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'RESPONSE_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VP, onProgress, onError, keystore, api, waitForCredentials]);

	/**
	 * Handle DC API request - parse URL, match credentials, store session
	 */
	const handleDCAPIRequest = useCallback(async (
		request: DCAPIRequest,
		selectedCredentialIDs: string[],
		verifiedOrigin: string
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		try {
			const clientIdForTrust = request.clientId ?? verifiedOrigin;
			const clientIdScheme = parseClientIdScheme(clientIdForTrust);

			const keyMaterial: KeyMaterial = request.isSigned
				? { type: request.keyMaterial.type, key: request.keyMaterial.value }
				: { type: 'resolution', key: [] }

			if (!request.isSigned) {
				logger.debug('Unsigned request, proceeding with resolution-based trust evaluation');
			}

			const trustResult = await transportContext?.trustEvaluators.evaluateVerifierTrust({
				clientIdScheme,
				keyMaterial,
			});

			if (!trustResult?.trusted) {
				throw new OIDFlowError({
					code: 'UNTRUSTED_VERIFIER',
					message: trustResult?.status ?? 'Verifier is not trusted',
				});
			}

			// We should filter the credentials based on the selectedCredentialIDs
			// if provided otherwise use all available credentials.
			const credentials = (await waitForCredentials())
				.filter(vc => selectedCredentialIDs.length === 0 || selectedCredentialIDs.includes(String(vc.batchId)));

			const { matches, no_match_reason } = matchCredentials(credentials, request.dcqlQuery);

			if (matches.length === 0) {
				throw new OIDFlowError({
					code: no_match_reason || 'NO_MATCHING_CREDENTIALS',
					message: 'No matching credentials',
				});
			}

			// Build conformant credentials map
			const conformantCredentials = buildConformantCredentialsMap(
				matches,
				request.dcqlQuery
			);

			return {
				success: true,
				conformantCredentials,
				dcqlQuery: request.dcqlQuery,
				verifierInfo: {
					name: trustResult?.name ?? verifiedOrigin,
					purpose: String(request.dcqlQuery.credential_sets?.[0]?.purpose ?? ''),
					domain: clientIdScheme.identifier,
					trustStatus: trustResult?.status,
					trusted: trustResult?.trusted ?? false,
					logo: trustResult?.logo,
				},
			};
		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'FLOW_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: { code: error.code, message: error.message },
			};
		} finally {
			setIsLoading(false);
		}
	}, [waitForCredentials, onError, transportContext?.trustEvaluators]);

	/**
	 * Send DC API response - sign, record history, send via session
	 */
	const sendDCAPIResponse = useCallback(async (
		session: DCAPISession,
		selectedCredentials: OID4VPSelectedCredential[]
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// DC API audience format per OpenID4VP spec
			const audience = `origin:${session.verifiedOrigin}`;

			const signResponse = await signPresentation({
				audience,
				nonce: session.request.nonce,
				origin: session.verifiedOrigin,
				verifierJwkThumbprint: await session.verifierJwkThumbprint(),
				credentialsToInclude: selectedCredentials.map(c => ({
					credentialId: c.walletCredentialRef,
					credentialQueryId: c.credentialQueryId,
					disclosedClaims: c.disclosedClaims,
					credentialRaw: c.credentialRaw,
				})),
			});

			if (keystore) {
				await recordPresentationHistory(keystore, api, selectedCredentials, audience);
			}

			if (!signResponse.vpToken) {
				throw new OIDFlowError({ code: 'SIGNING_FAILED', message: 'Failed to generate VP token' });
			}

			await session.sendResponse(JSON.parse(signResponse.vpToken));
			return { success: true };
		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'RESPONSE_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: { code: error.code, message: error.message },
			};
		} finally {
			setIsLoading(false);
		}
	}, [signPresentation, keystore, api, onError]);

	return {
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
		transportType,
		isLoading,
		error,
		clearError,
		handleDCAPIRequest,
		sendDCAPIResponse,
	};
}

export default useOID4VPFlow;

/**
 * Build conformant credentials map from DCQL matches
 */
function buildConformantCredentialsMap(
	matches: Array<{ input_descriptor_id: string; credential_id: string }>,
	dcqlQuery: DcqlQuery.Input
): Map<string, { credentials: number[]; requestedFields: Array<{ name?: string; path?: string[] }> }> {
	const result = new Map<string, {
		credentials: number[];
		requestedFields: Array<{ name?: string; path?: string[] }>
	}>();

	for (const match of matches) {
		if (!result.has(match.input_descriptor_id)) {
			const credDef = dcqlQuery.credentials.find(c => c.id === match.input_descriptor_id);
			result.set(match.input_descriptor_id, {
				credentials: [],
				requestedFields: (credDef?.claims ?? []).map(c => ({
					name: c.path?.[c.path.length - 1],
					path: c.path,
				})),
			});
		}
		result.get(match.input_descriptor_id).credentials.push(Number.parseInt(match.credential_id));
	}

	return result;
}

/**
 * Record presentation history for sigCount tracking
 */
async function recordPresentationHistory(
	keystore: LocalStorageKeystore,
	api: BackendApi,
	selectedCredentials: OID4VPSelectedCredential[],
	audience: string
): Promise<void> {
	const transactionId = crypto.getRandomValues(new Uint32Array(1))[0];
	const presentations = await Promise.all(selectedCredentials.map(async (cred) => ({
		transactionId,
		data: await applySelectiveDisclosure(cred.credentialRaw, cred.disclosedClaims ?? []),
		usedCredentialIds: [Number.parseInt(cred.walletCredentialRef)],
		audience,
	})));
	const [, newPrivateData, keystoreCommit] = await keystore.addPresentations(presentations);
	await api.updatePrivateData(newPrivateData);
	await keystoreCommit();
}
