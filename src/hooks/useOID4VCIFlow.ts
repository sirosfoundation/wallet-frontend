/**
 * Hybrid OID4VCI Flow Hook
 *
 * This hook provides a unified interface for credential issuance flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useRef, useState } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import OpenID4VCIContext from '@/context/OpenID4VCIContext';
import { CredentialOfferSchema } from 'wallet-common';
import type { OID4VCIFlowResult } from '@/lib/transport/types/OID4VCITypes';
import type { FlowProgressEvent, TransportType } from '@/lib/transport/types/FlowTypes';

export interface UseOID4VCIFlowOptions {
	/** Called when flow progress updates */
	onProgress?: (event: FlowProgressEvent) => void;
	/** Called when an error occurs */
	onError?: (error: Error) => void;
}

export interface UseOID4VCIFlowReturn {
	/** Start an OID4VCI flow with a credential offer URI */
	handleCredentialOffer: (credentialOfferUri: string) => Promise<OID4VCIFlowResult>;

	/** Continue flow with authorization code (after redirect) */
	handleAuthorizationResponse: (authCode: string, codeVerifier?: string) => Promise<OID4VCIFlowResult>;

	/** Continue flow with pre-authorized code and optional TX code */
	requestWithPreAuthorization: (
		preAuthorizedCode: string,
		txCodeInput?: string
	) => Promise<OID4VCIFlowResult>;

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
 * Hook for credential issuance flows with transport abstraction
 *
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VCI implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VCIFlow(options: UseOID4VCIFlowOptions = {}): UseOID4VCIFlowReturn {
	const { onProgress, onError } = options;

	const transportContext = useFlowTransportSafe();
	const { openID4VCI } = useContext(OpenID4VCIContext);

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Track offer state from handleCredentialOffer for use in requestWithPreAuthorization.
	// Uses useRef to avoid stale closure issues in useCallback — the ref always
	// reflects the latest value without needing to be in dependency arrays.
	const offerStateRef = useRef<{
		credentialIssuer: string;
		selectedCredentialConfigurationId: string;
	} | null>(null);

	const transportType = transportContext?.transportType ?? 'none';
	const transport = transportContext?.transport;

	const clearError = useCallback(() => {
		setError(null);
		transportContext?.clearError?.();
	}, [transportContext]);

	/**
	 * Validate a credential offer URI by parsing parameters through CredentialOfferSchema.
	 * This provides defense-in-depth: even when the backend handles the flow (WebSocket),
	 * the frontend validates the offer structure before dispatching.
	 *
	 * For `credential_offer_uri` (fetch-based) offers, validation is deferred to the
	 * backend/service since the frontend hasn't fetched the offer content yet.
	 */
	const validateCredentialOffer = useCallback((credentialOfferUri: string): void => {
		const parsedUrl = new URL(credentialOfferUri);
		const inlineOffer = parsedUrl.searchParams.get("credential_offer");
		if (inlineOffer) {
			// Throws ZodError if the offer is malformed — caught by the outer try/catch
			CredentialOfferSchema.parse(JSON.parse(inlineOffer));
		}
		// credential_offer_uri: content not available yet, validated when fetched
	}, []);

	/**
	 * Handle credential offer using the appropriate transport
	 */
	const handleCredentialOffer = useCallback(async (
		credentialOfferUri: string
	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// Validate inline offers before dispatching to any transport
			validateCredentialOffer(credentialOfferUri);

			// WebSocket transport: delegate to backend
			if (transportType === 'websocket' && transport) {
				// Subscribe to progress events for this flow
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};
				const unsubscribeError = onError
					? transport.onError(onError)
					: () => {};

				try {
					const result = await transport.startOID4VCIFlow({
						credentialOfferUri,
					});
					return result;
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VCI) {
				try {
					const result = await openID4VCI.handleCredentialOffer(credentialOfferUri);

					// Save offer state for requestWithPreAuthorization
					if (result.preAuthorizedCode) {
						offerStateRef.current = {
							credentialIssuer: result.credentialIssuer,
							selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
						};
					}

					// Convert to OID4VCIFlowResult format
					return {
						success: true,
						selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
						preAuthorizedCode: result.preAuthorizedCode,
						issuerState: result.issuer_state,
						txCode: result.txCode,
					};
				} catch (err) {
					throw err;
				}
			}

			// No transport available
			throw new Error('No transport available for credential issuance');

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
	}, [transportType, transport, openID4VCI, onProgress, onError, validateCredentialOffer]);

	/**
	 * Handle authorization response (after OAuth redirect)
	 */
	const handleAuthorizationResponse = useCallback(async (
		authCode: string,
		codeVerifier?: string
	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: continue flow on backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};

				try {
					const result = await transport.startOID4VCIFlow({
						authorizationCode: authCode,
						codeVerifier,
					});
					return result;
				} finally {
					unsubscribeProgress();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VCI) {
				// Note: handleAuthorizationResponse in the current implementation
				// takes the full URL with the code as a parameter. The hook may
				// receive either a bare authorization code or the full redirect URL,
				// so normalize to a full URL here.
				let redirectUrl = authCode;
				if (typeof authCode === 'string' && !authCode.includes('://') && typeof window !== 'undefined') {
					const url = new URL(window.location.href);
					url.searchParams.set('code', authCode);
					redirectUrl = url.toString();
				}
				await openID4VCI.handleAuthorizationResponse(redirectUrl);

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
					code: 'AUTH_RESPONSE_ERROR',
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VCI, onProgress, onError]);

	/**
	 * Request credentials with pre-authorized code flow
	 */
	const requestWithPreAuthorization = useCallback(async (
		preAuthorizedCode: string,
		txCodeInput?: string
	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};

				try {
					const result = await transport.startOID4VCIFlow({
						preAuthorizedCode,
						txCodeInput,
					});
					return result;
				} finally {
					unsubscribeProgress();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VCI) {
				if (!offerStateRef.current) {
					throw new Error(
						'Pre-authorization flow via HTTP transport requires calling ' +
						'handleCredentialOffer first to establish offer state.'
					);
				}
				await openID4VCI.requestCredentialsWithPreAuthorization(
					offerStateRef.current.credentialIssuer,
					offerStateRef.current.selectedCredentialConfigurationId,
					preAuthorizedCode,
					txCodeInput,
				);
				return { success: true };
			}

			throw new Error('No transport available');

		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: 'PREAUTH_ERROR',
					message: error.message,
				},
			};
		} finally {
			offerStateRef.current = null;
			setIsLoading(false);
		}
	}, [transportType, transport, openID4VCI, onProgress, onError]);

	return {
		handleCredentialOffer,
		handleAuthorizationResponse,
		requestWithPreAuthorization,
		transportType,
		isLoading,
		error,
		clearError,
	};
}

export default useOID4VCIFlow;
