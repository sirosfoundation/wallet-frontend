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
import { InvalidTxCodeError, RawTxCodeSpec } from '@/lib/services/OpenID4VCI/OpenID4VCI';
import { logger } from '@/logger';

export interface UseOID4VCIFlowOptions {
	/** Called when flow progress updates */
	onProgress?: (event: FlowProgressEvent) => void;
	/** Called when an error occurs */
	onError?: (error: Error) => void;
}

/** Callback for requesting TX code input from user */
export type TxCodeRequestFn = (config: {
	description?: string;
	length?: number;
	inputMode?: 'numeric' | 'text';
}) => Promise<string>;

export interface ProcessCredentialOfferOptions {
	/** Callback to prompt user for transaction code. Required for pre-auth offers with tx_code. */
	requestTxCode?: TxCodeRequestFn;
	/** Maximum number of TX code retries after the initial attempt (default: 2, so 3 total attempts) */
	maxTxCodeRetries?: number;
	/** Description shown when re-prompting after invalid TX code */
	txCodeRetryDescription?: string;
}

export interface UseOID4VCIFlowReturn {
	/**
	 * Process a credential offer end-to-end:
	 * - Parses the offer and determines flow type (auth-code vs pre-auth)
	 * - Auth-code flow: generates authorization request, returns authorizationUrl
	 * - Pre-auth flow: prompts for TX code if needed, handles retries, issues credential
	 * - Includes pre-authorized code replay protection
	 */
	processCredentialOffer: (
		credentialOfferUri: string,
		options?: ProcessCredentialOfferOptions,
	) => Promise<OID4VCIFlowResult>;

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

	// Track used pre-authorized codes to prevent replay within this session
	const usedPreAuthCodesRef = useRef<Set<string>>(new Set());

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

	/**
	 * Process a credential offer end-to-end.
	 * For WebSocket transport, delegates the entire flow to the backend.
	 * For HTTP proxy, orchestrates offer parsing, flow routing, TX code prompting,
	 * and credential request with retry logic.
	 */
	const processCredentialOffer = useCallback(async (
		credentialOfferUri: string,
		options: ProcessCredentialOfferOptions = {},
	): Promise<OID4VCIFlowResult> => {
		const { requestTxCode, maxTxCodeRetries = 2, txCodeRetryDescription } = options;

		setIsLoading(true);
		setError(null);

		try {
			validateCredentialOffer(credentialOfferUri);

			// WebSocket transport: delegate entire flow to backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};
				const unsubscribeError = onError
					? transport.onError(onError)
					: () => {};

				try {
					return await transport.startOID4VCIFlow({ credentialOfferUri });
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: orchestrate the full flow
			if (transportType === 'http_proxy' && openID4VCI) {
				const offer = await openID4VCI.handleCredentialOffer(credentialOfferUri);

				// Auth-code flow: generate authorization request and return URL
				if (!offer.preAuthorizedCode) {
					logger.debug("Generating authorization request...");
					const authResult = await openID4VCI.generateAuthorizationRequest(
						offer.credentialIssuer,
						offer.selectedCredentialConfigurationId,
						offer.issuer_state,
					);
					if (!authResult?.url) {
						return {
							success: false,
							error: { code: 'AUTH_REQUEST_ERROR', message: 'Failed to generate authorization request URL' },
						};
					}
					return {
						success: true,
						authorizationUrl: authResult.url,
					};
				}

				// Pre-auth replay protection
				if (usedPreAuthCodesRef.current.has(offer.preAuthorizedCode)) {
					logger.debug("Already used pre-authorized code, ignoring");
					return { success: true };
				}
				usedPreAuthCodesRef.current.add(offer.preAuthorizedCode);

				// TX code is required but no callback to prompt user
				if (offer.txCode && !requestTxCode) {
					usedPreAuthCodesRef.current.delete(offer.preAuthorizedCode);
					return {
						success: false,
						error: { code: 'TX_CODE_REQUIRED', message: 'Transaction code required but no requestTxCode callback provided' },
					};
				}

				try {
					// Prompt for TX code if required
					let txCodeInput: string | undefined;
					if (offer.txCode && requestTxCode) {
						const rawTxCode = offer.txCode as RawTxCodeSpec;
						txCodeInput = await requestTxCode({
							description: rawTxCode.description ?? undefined,
							length: rawTxCode.length ?? undefined,
							inputMode: rawTxCode.input_mode === 'numeric' ? 'numeric' : 'text',
						});
					}

					// Request credential with pre-authorization, retrying on invalid TX code
					logger.debug("Requesting credential with pre-authorization...");
					for (let attempt = 0; attempt <= maxTxCodeRetries; attempt++) {
						try {
							await openID4VCI.requestCredentialsWithPreAuthorization(
								offer.credentialIssuer,
								offer.selectedCredentialConfigurationId,
								offer.preAuthorizedCode,
								txCodeInput,
							);
							return { success: true };
						} catch (retryErr) {
							if (
								retryErr instanceof InvalidTxCodeError &&
								offer.txCode &&
								requestTxCode &&
								attempt < maxTxCodeRetries
							) {
								logger.info("Invalid transaction code, prompting for retry");
								const rawTxCode = offer.txCode as RawTxCodeSpec;
								txCodeInput = await requestTxCode({
									description: txCodeRetryDescription ?? rawTxCode.description ?? undefined,
									length: rawTxCode.length ?? undefined,
									inputMode: rawTxCode.input_mode === 'numeric' ? 'numeric' : 'text',
								});
								continue;
							}
							throw retryErr;
						}
					}

					return { success: true };
				} catch (preAuthErr) {
					usedPreAuthCodesRef.current.delete(offer.preAuthorizedCode);
					throw preAuthErr;
				}
			}

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

	return {
		processCredentialOffer,
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
