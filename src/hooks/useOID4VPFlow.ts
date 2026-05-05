/**
 * Hybrid OID4VP Flow Hook
 *
 * This hook provides a unified interface for verifiable presentation flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
	useOIDFlowTransportSafe,
	// type WSMatchRequest as MatchRequest,
	// type WSMatchResponse as MatchResponse,
} from '@/context/OIDFlowTransportContext';
import SessionContext from '@/context/SessionContext';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import { matchCredentials } from '@/services/CredentialMatchingService';
import type {
	OID4VPFlowResult,
	OID4VPSelectedCredential,
	OID4VPVerifierInfo,
} from '@/lib/openid-flow/types/OID4VPTypes';
import type { OIDFlowProgressEvent, OIDFlowTransportType } from '@/lib/openid-flow/types/OIDFlowTypes';
import { DcqlQuery } from 'dcql';
import { getLeastUsedCredentialInstance } from '@/lib/services/CredentialBatchHelper';
import { applySelectiveDisclosure } from '@/lib/sd-jwt/sd-jwt';
import { OIDFlowError } from '@/lib/openid-flow/errors';

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
		conformantCredentialsMap: Record<string, { credentials: number[]; requestedFields: Array<{ name?: string; path?: (string | null)[] }> }>,
		verifierDomainName: string,
		verifierPurpose: string,
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
	transportType: OIDFlowTransportType | 'none';
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

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const transportType = transportContext?.transportType ?? 'none';
	const transport = transportContext?.transport;

	const transportTypeRef = useRef(transportType);
	const transportRef = useRef(transport);
	useEffect(() => {
		transportTypeRef.current = transportType;
		transportRef.current = transport;
	}, [transportType, transport]);

	const clearError = useCallback(() => {
		setError(null);
		transportContext?.clearError?.();
	}, [transportContext]);

	const vcEntityListRef = useRef(vcEntityList);
	const credentialsReadyResolvers = useRef<((list: ExtendedVcEntity[]) => void)[]>([]);
	const verifierAudienceRef = useRef<string>('');

	/**
	 *
	 */
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
	//  * Register match handler for client-side credential matching
	//  * This is called when the server requests credential matching for privacy
	//  */
	// useEffect(() => {
	// 	if (transportType !== 'websocket' || !transportContext?.registerMatchHandler) {
	// 		return;
	// 	}

	// 	const handleMatchRequest = async (request: MatchRequest): Promise<MatchResponse> => {
	// 		try {
	// 			const result = matchCredentials(
	// 				vcEntityList || [],
	// 				request.dcqlQuery,
	// 			);
	// 			return result;
	// 		} catch (err) {
	// 			console.error('Credential matching failed', err);
	// 			return {
	// 				matches: [],
	// 				no_match_reason: 'Credential matching failed',
	// 			};
	// 		}
	// 	};

	// 	const unsubscribe = transportContext.registerMatchHandler(handleMatchRequest);
	// 	return unsubscribe;
	// }, [transportType, transportContext, vcEntityList]);

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
			if (transportTypeRef.current === 'websocket' && transportRef.current) {
				const unsubscribeProgress = onProgress
					? transportRef.current.onProgress(onProgress)
					: () => {};
				const unsubscribeError = onError
					? transportRef.current.onError(onError)
					: () => {};

				try {
					const requestUriRef = authorizationRequestUrl.searchParams.get('request_uri');
					const clientId = authorizationRequestUrl.searchParams.get('client_id');
					verifierAudienceRef.current = clientId ?? '';
					const result = await transportRef.current.startOID4VPFlow({
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
			if (transportTypeRef.current === 'http_proxy' && openID4VP) {
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
	}, [openID4VP, onProgress, onError, waitForCredentials]);

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
			let conformantCredentialsMap: Record<string, {
				credentials: number[];
				requestedFields: Array<{
					name?: string;
					path?: string[];
				}>;
			}> = {};

			if (preMatchedCredentials) {
				conformantCredentialsMap = Object.fromEntries(preMatchedCredentials);
			} else if (dcqlQuery) {
				const { matches, no_match_reason } = matchCredentials(credentials, dcqlQuery);

				if (matches.length === 0) {
					throw new OIDFlowError({ code: no_match_reason || 'NO_MATCHING_CREDENTIALS', message: 'No matching credentials' });
				}

				for (const match of matches) {
					if (!conformantCredentialsMap[match.input_descriptor_id]) {
						const credDef = dcqlQuery.credentials.find(c => c.id === match.input_descriptor_id);
						conformantCredentialsMap[match.input_descriptor_id] = {
							credentials: [],
							requestedFields: (credDef?.claims ?? []).map(c => ({
								name: c.path?.[c.path.length - 1],
								path: c.path,
							})),
						};
					}
					conformantCredentialsMap[match.input_descriptor_id].credentials.push(
						parseInt(match.credential_id)
					);
				}
			} else {
				throw new OIDFlowError({ code: 'NO_DCQL_QUERY_OR_PREMATCHED_CREDENTIALS', message: 'No dcqlQuery or preMatchedCredentials provided' });
			}

			if (Object.keys(conformantCredentialsMap).length === 0) {
				throw new OIDFlowError({ code: 'INSUFFICIENT_CREDENTIALS', message: 'No credentials available for selection' });
			}

			// Show popup → user picks descriptorId → batchId
			const selectionMap = await options.onCredentialSelection(
				conformantCredentialsMap,
				verifierInfo?.name ?? '',
				verifierInfo?.purpose ?? '',
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
			if (transportTypeRef.current === 'websocket' && transportRef.current) {
				const unsubscribeProgress = onProgress
					? transportRef.current.onProgress(onProgress)
					: () => {};

				try {
					const result = await transportRef.current.startOID4VPFlow({
						selectedCredentials,
					});

					// Record presentation history for sigCount tracking
					if (keystore) {
						const transactionId = crypto.getRandomValues(new Uint32Array(1))[0];
						const presentations = await Promise.all(selectedCredentials.map(async (cred) => ({
							transactionId,
							data: await applySelectiveDisclosure(cred.credentialRaw, cred.disclosedClaims ?? []),
							usedCredentialIds: [parseInt(cred.walletCredentialRef)],
							audience: verifierAudienceRef.current,
						})));
						const [, newPrivateData, keystoreCommit] = await keystore.addPresentations(presentations);
						await api.updatePrivateData(newPrivateData);
						await keystoreCommit();
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
			if (transportTypeRef.current === 'http_proxy' && openID4VP) {
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
			const error = err instanceof OIDFlowError ? err : new OIDFlowError({ code: 'RESPONSE_ERROR', message: err instanceof Error ? err.message : String(err) });
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
	}, [openID4VP, onProgress, onError, keystore, api, waitForCredentials]);

	return {
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
		transportType,
		isLoading,
		error,
		clearError,
	};
}

export default useOID4VPFlow;
