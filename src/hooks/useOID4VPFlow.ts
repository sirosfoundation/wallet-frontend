/**
 * Hybrid OID4VP Flow Hook
 *
 * This hook provides a unified interface for verifiable presentation flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useEffect, useState } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import { matchCredentials } from '@/services/CredentialMatchingService';
import type { MatchRequest, MatchResponse } from '@/lib/transport/WebSocketTransport';
import type {
	OID4VPFlowResult,
	OID4VPSelectedCredential,
} from '@/lib/transport/types/OID4VPTypes';
import type { FlowProgressEvent, TransportType } from '@/lib/transport/types/FlowTypes';

export interface UseOID4VPFlowOptions {
	/** Called when flow progress updates */
	onProgress?: (event: FlowProgressEvent) => void;
	/** Called when an error occurs */
	onError?: (error: Error) => void;
}

export interface UseOID4VPFlowReturn {
	/** Start an OID4VP flow with an authorization request URI */
	handleAuthorizationRequest: (
		authorizationRequestUri: string
	) => Promise<OID4VPFlowResult>;

	/** Send authorization response with selected credentials */
	sendAuthorizationResponse: (
		selectedCredentials: OID4VPSelectedCredential[]
	) => Promise<OID4VPFlowResult>;

	/** Current transport type being used */
	transportType: TransportType | 'none';

	/** Whether a flow is currently in progress */
	isLoading: boolean;

	/** Last error if any */
	error: Error | null;

	/** Clear the last error */
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

	const transportContext = useFlowTransportSafe();
	const { openID4VP } = useContext(OpenID4VPContext);
	const { vcEntityList } = useContext(CredentialsContext) as { vcEntityList: ExtendedVcEntity[] };

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const transportType = transportContext?.transportType ?? 'none';
	const transport = transportContext?.transport;

	const clearError = useCallback(() => {
		setError(null);
		transportContext?.clearError?.();
	}, [transportContext]);

	/**
	 * Register match handler for client-side credential matching
	 * This is called when the server requests credential matching for privacy
	 */
	useEffect(() => {
		if (transportType !== 'websocket' || !transportContext?.registerMatchHandler) {
			return;
		}

		const handleMatchRequest = async (request: MatchRequest): Promise<MatchResponse> => {
			try {
				const result = matchCredentials(
					vcEntityList || [],
					request.presentationDefinition
				);
				return result;
			} catch (err) {
				const errMessage = err instanceof Error ? err.message : String(err);
				return {
					matches: [],
					no_match_reason: `Matching error: ${errMessage}`,
				};
			}
		};

		const unsubscribe = transportContext.registerMatchHandler(handleMatchRequest);
		return unsubscribe;
	}, [transportType, transportContext, vcEntityList]);

	/**
	 * Handle authorization request using the appropriate transport
	 */
	const handleAuthorizationRequest = useCallback(async (
		authorizationRequestUri: string
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
					const result = await transport.startOID4VPFlow({
						authorizationRequestUri,
					});
					return result;
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VP) {
				try {
					const result = await openID4VP.handleAuthorizationRequest(
						authorizationRequestUri,
						vcEntityList || []
					);

					// Check for error response
					if ('error' in result) {
						return {
							success: false,
							error: {
								code: result.error || 'VP_ERROR',
								message: result.error || 'Unknown error',
							},
						};
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
							description: td.parsed?.description || JSON.stringify(td.parsed || td).slice(0, 100),
							data: td,
						})),
					};
				} catch (err) {
					throw err;
				}
			}

			// No transport available
			throw new Error('No transport available for verifiable presentation');

		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: 'FLOW_ERROR',
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VP, vcEntityList, onProgress, onError]);

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

				// Note: This assumes the credential indices match vcEntityList
				// In practice, we'd need more sophisticated matching
				selectedCredentials.forEach(cred => {
					// Find the credential index in vcEntityList
					const index = vcEntityList?.findIndex(
						entity => entity.data === cred.credentialRaw
					) ?? -1;

					if (index !== -1) {
						selectionMap.set(cred.descriptorId, index);
					}
				});

				const result = await openID4VP.sendAuthorizationResponse(
					selectionMap,
					vcEntityList || []
				);

				// Check result type
				if ('url' in result && result.url) {
					return {
						success: true,
						redirectUri: result.url,
					};
				}

				if ('presentation_during_issuance_session' in result) {
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

			throw new Error('No transport available');

		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: 'RESPONSE_ERROR',
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VP, vcEntityList, onProgress, onError]);

	return {
		handleAuthorizationRequest,
		sendAuthorizationResponse,
		transportType,
		isLoading,
		error,
		clearError,
	};
}

export default useOID4VPFlow;
