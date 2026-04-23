import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFlowTransportSafe } from '@/context/FlowTransportContext';
import OpenID4VCIContext from '@/context/OpenID4VCIContext';
import { CredentialOfferSchema, VerifiableCredentialFormat } from 'wallet-common';
import type { OID4VCIFlowResult } from '@/lib/transport/types/OID4VCITypes';
import type { FlowProgressEvent, TransportType } from '@/lib/transport/types/FlowTypes';
import { DISPLAY_ISSUANCE_WARNINGS, OPENID4VCI_REDIRECT_URI } from '@/config';
import { deriveHolderKidFromCredential } from '@/lib/services/OpenID4VCI/OpenID4VCI';
import SessionContext from '@/context/SessionContext';
import { notify } from '@/context/notifier';
import CredentialsContext from '@/context/CredentialsContext';
import { logger } from '@/logger';

export interface UseOID4VCIFlowOptions {
	/**
	 * Called when flow progress updates
	 */
	onProgress?: (event: FlowProgressEvent) => void;
	/**
	 * Called when an error occurs
	 */
	onError?: (error: Error) => void;
	/**
	 * Called when credential has warnings. Return true to proceed, false to abort.
	 */
	onIssuanceWarnings?: (warnings: Array<{ code: string }>) => Promise<boolean>;
}

export interface UseOID4VCIFlowReturn {
	/**
	 * Start an OID4VCI flow with a credential offer URI
	 */
	handleCredentialOffer: (credentialOfferUri: URL) => Promise<OID4VCIFlowResult>;
	/**
	 * Continue flow with authorization code (after redirect)
	 */
	handleAuthorizationResponse: (authCode: string, state?: string) => Promise<OID4VCIFlowResult>;
	/**
	 * Continue flow with pre-authorized code and optional TX code
	 */
	requestWithPreAuthorization: (
		preAuthorizedCode: string,
		txCodeInput?: string
	) => Promise<OID4VCIFlowResult>;
	/**
	 * Handle received credentials: validate, store in wallet, and notify
	 */
	handleReceivedCredentials: (
		credentials: OID4VCIFlowResult['credentials'],
		credentialIssuerIdentifier?: string,
		credentialConfigurationId?: string,
	) => Promise<OID4VCIFlowResult>;
	/**
	 * Current transport type being used
	 */
	transportType: TransportType | 'none';
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
 * Hook for credential issuance flows with transport abstraction
 *
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VCI implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VCIFlow(options: UseOID4VCIFlowOptions = {}): UseOID4VCIFlowReturn {
	const { onProgress, onError, onIssuanceWarnings } = options;

	const { credentialEngine } = useContext(CredentialsContext);
	const { api, keystore } = useContext(SessionContext);
	const transportContext = useFlowTransportSafe();
	const { openID4VCI } = useContext(OpenID4VCIContext);

	const abortRef = useRef<AbortController>(new AbortController());
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

	/**
	 * Cleanup on unmount.
	 */
	useEffect(() => {
		return () => {
			abortRef.current.abort();
		}
	}, []);

	/**
	 * Assert that the flow has not been aborted. Used to short-circuit after aborting.
	 */
	const assertNotAborted = useCallback(() => {
		if (abortRef.current.signal.aborted) {
			throw new Error('Flow aborted');
		}
	}, []);

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
	const validateCredentialOffer = useCallback((credentialOfferUrl: URL): void => {
		const inlineOffer = credentialOfferUrl.searchParams.get('credential_offer');
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
		credentialOfferUrl: URL
	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// Validate inline offers before dispatching to any transport
			validateCredentialOffer(credentialOfferUrl);

			// WebSocket transport: delegate to backend
			if (transportType === 'websocket' && transport) {
				const credentialOfferUri = credentialOfferUrl.searchParams.get('credential_offer_uri') || undefined;
				const credentialOffer = credentialOfferUrl.searchParams.get('credential_offer') || undefined;

				if (!credentialOfferUri && !credentialOffer) {
					throw new Error('WebSocket transport requires credential_offer_uri or credential_offer parameter');
				}

				if (credentialOfferUri && credentialOffer) {
					throw new Error('WebSocket transport should not have both credential_offer_uri and credential_offer parameters');
				}

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
						credentialOffer,
						redirectUri: OPENID4VCI_REDIRECT_URI,
					});

					assertNotAborted();

					if (result.authorizationUrl && result.codeVerifier) {
						// Save pending flow state for resumption after redirect
						savePendingFlow({
							flowId: result.transactionId,
							codeVerifier: result.codeVerifier,
							state: result.issuerState,
							credentialOffer: result.credentialOffer
								? JSON.stringify(result.credentialOffer)
								: undefined,
							timestamp: Date.now(),
						});
					}

					if (!result.success && result.error) {
						throw new Error(result.error.message);
					}

					return result;
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VCI) {
				const result = await openID4VCI.handleCredentialOffer(credentialOfferUrl.toString());

				assertNotAborted();

				// Save offer state for requestWithPreAuthorization
				if (result.preAuthorizedCode) {
					offerStateRef.current = {
						credentialIssuer: result.credentialIssuer,
						selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
					};

					return {
						success: true,
						credentialIssuerIdentifier: result.credentialIssuer,
						selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
						preAuthorizedCode: result.preAuthorizedCode,
						issuerState: result.issuer_state,
						txCode: result.txCode,
					};
				}

				const authRequestResult = await openID4VCI.generateAuthorizationRequest(
					result.credentialIssuer,
					result.selectedCredentialConfigurationId,
					result.issuer_state
				);

				if (!authRequestResult.url) {
					throw new Error('Failed to generate authorization request URL');
				}

				return {
					success: true,
					credentialIssuerIdentifier: result.credentialIssuer,
					selectedCredentialConfigurationId: result.selectedCredentialConfigurationId,
					authorizationRequired: true,
					authorizationUrl: authRequestResult.url,
					issuerState: result.issuer_state,
				};
			}

			throw new Error('No transport available for credential issuance');
		} catch (err) {
			if (abortRef.current.signal.aborted) {
				return { success: false, error: { code: 'ABORTED', message: 'Flow cancelled' } };
			}

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
		state?: string
	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: continue flow on backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};

				const storedFlow = loadAndClearPendingFlow();

				if (state !== storedFlow?.state) throw new Error('State mismatch in authorization response');

				try {
					// Resumption: pass saved offer + auth code to start fresh backend flow
					const result = await transport.startOID4VCIFlow({
						credentialOffer: storedFlow?.credentialOffer,
						authorizationCode: authCode,
						codeVerifier: storedFlow?.codeVerifier,
						redirectUri: OPENID4VCI_REDIRECT_URI,
					});

					assertNotAborted();

					if (!result.success && result.error) {
						throw new Error(result.error.message);
					}

					return result;
				} finally {
					unsubscribeProgress();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy' && openID4VCI) {
				const url = new URL(window.location.href);
				url.searchParams.set('code', authCode);
				url.searchParams.set('state', state || '');
				const result = await openID4VCI.handleAuthorizationResponse(url.toString());

				assertNotAborted();

				if (!result.credentials || result.credentials.length === 0) {
					throw new Error('No credentials received in authorization response');
				}

				return {
					success: true,
					credentials: result.credentials,
					credentialIssuerIdentifier: result.credentialIssuerIdentifier,
					selectedCredentialConfigurationId: result.credentialConfigurationId,
				};
			}

			throw new Error('No transport available');

		} catch (err) {
			if (abortRef.current.signal.aborted) {
				return { success: false, error: { code: 'ABORTED', message: 'Flow cancelled' } };
			}

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

					assertNotAborted();

					if (!result.success && result.error) {
						throw new Error(result.error.message);
					}

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
				const result = await openID4VCI.requestCredentialsWithPreAuthorization(
					offerStateRef.current.credentialIssuer,
					offerStateRef.current.selectedCredentialConfigurationId,
					preAuthorizedCode,
					txCodeInput,
				);

				assertNotAborted();

				if (!result.credentials || result.credentials.length === 0) {
					throw new Error('No credentials received in pre-authorization response');
				}

				return {
					success: true,
					credentials: result.credentials,
					credentialIssuerIdentifier: result.credentialIssuerIdentifier,
					selectedCredentialConfigurationId: result.credentialConfigurationId,
				};
			}

			throw new Error('No transport available');

		} catch (err) {
			if (abortRef.current.signal.aborted) {
				return { success: false, error: { code: 'ABORTED', message: 'Flow cancelled' } };
			}

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
	 * Handle received credentials: validate, store in wallet, and notify.
	 */
	const handleReceivedCredentials = useCallback(async (
		credentials: OID4VCIFlowResult['credentials'],
		credentialIssuerIdentifier?: OID4VCIFlowResult['credentialIssuerIdentifier'],
		credentialConfigurationId?: OID4VCIFlowResult['selectedCredentialConfigurationId'],

	): Promise<OID4VCIFlowResult> => {
		setIsLoading(true);
		setError(null);

		const credentialIssuer = credentialIssuerIdentifier ?? '';
		const credentialConfigId = credentialConfigurationId ?? '';

		try {
			if (!credentials || credentials.length === 0) throw new Error('No credentials to store');

			const formats = credentials.map(c =>
				c.format ? c.format as VerifiableCredentialFormat : inferFormatFromCredential(c.credential)
			);

			const batchFormat = formats[0];
			const batchId = Date.now();

			if (formats.some(f => f !== batchFormat)) {
				throw new Error('Mixed credential formats in a single batch are not supported');
			}

			const credentialsToStore = await Promise.all(credentials.map(async (c, idx) => {
				let kid = '';

				// Derive kid from credential based on format
				if (
					batchFormat === VerifiableCredentialFormat.VC_SDJWT ||
					batchFormat === VerifiableCredentialFormat.DC_SDJWT ||
					batchFormat === VerifiableCredentialFormat.MSO_MDOC
				) {
					kid = await deriveHolderKidFromCredential(c.credential, batchFormat) ?? '';
				}

				return {
					data: c.credential,
					format: batchFormat,
					kid: kid,
					batchId,
					credentialIssuerIdentifier: credentialIssuer,
					credentialConfigurationId: credentialConfigId,
					instanceId: idx,
				};
			}));

			// We assume that all credentials in the batch are the same,
			// so parsing one is sufficient for validation and metadata extraction.
			const parseResult = await credentialEngine.credentialParsingEngine.parse({
				rawCredential: credentialsToStore[0].data,
				credentialIssuer: {
					credentialIssuerIdentifier: credentialsToStore[0].credentialIssuerIdentifier,
					credentialConfigurationId: credentialsToStore[0].credentialConfigurationId,
				},
			});

			if (parseResult.success === false) {
					throw new Error(`Credential parsing failed: ${parseResult.error}`);
			}

			if (parseResult.value.warnings?.length > 0) {
				if (DISPLAY_ISSUANCE_WARNINGS && onIssuanceWarnings) {
					const consent = await onIssuanceWarnings(parseResult.value.warnings);
					if (!consent) throw new Error('User declined to store credential due to warnings');
				}
			}

			assertNotAborted();
			const [, privateData, commit] = await keystore.addCredentials(credentialsToStore);

			assertNotAborted();
			await api.updatePrivateData(privateData);
			await commit();

			notify('newCredential');

			return { success: true };
		} catch (err) {
			if (abortRef.current.signal.aborted) {
				return { success: false, error: { code: 'ABORTED', message: 'Flow cancelled' } };
			}

			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: 'STORE_ERROR',
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [api, keystore,	credentialEngine.credentialParsingEngine, onError, onIssuanceWarnings]);

	return {
		handleCredentialOffer,
		handleAuthorizationResponse,
		requestWithPreAuthorization,
		handleReceivedCredentials,
		transportType,
		isLoading,
		error,
		clearError,
	};
}

// Storage key for pending OID4VCI flow state
const OID4VCI_PENDING_FLOW_KEY = 'oid4vci_pending_flow';

export interface PendingOID4VCIFlow {
	flowId?: string;
	codeVerifier?: string;
	state?: string;
	credentialOffer?: string;
	timestamp: number;
}

/**
 * Save pending flow state for resumption after same-tab redirect
 */
function savePendingFlow(flow: PendingOID4VCIFlow): void {
	sessionStorage.setItem(OID4VCI_PENDING_FLOW_KEY, JSON.stringify(flow));
}

/**
 * Load and clear pending flow state
 */
function loadAndClearPendingFlow(): PendingOID4VCIFlow | null {
	const stored = sessionStorage.getItem(OID4VCI_PENDING_FLOW_KEY);
	if (!stored) return null;

	sessionStorage.removeItem(OID4VCI_PENDING_FLOW_KEY);

	try {
		const flow = JSON.parse(stored) as PendingOID4VCIFlow;
		// Expire after 10 minutes
		if (Date.now() - flow.timestamp > 10 * 60 * 1000) {
			return null;
		}
		return flow;
	} catch {
		return null;
	}
}

/**
 * Infer credential format from the credential string
 */
function inferFormatFromCredential(credential: string): VerifiableCredentialFormat {
	try {
		const jwtPart = credential.split('~')[0];
		const headerB64 = jwtPart.split('.')[0];
		const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));

		if (header.typ === 'dc+sd-jwt') return VerifiableCredentialFormat.DC_SDJWT;
		if (header.typ === 'vc+sd-jwt') return VerifiableCredentialFormat.VC_SDJWT;
		if (header.typ === 'JWT' || header.typ === 'jwt_vc_json') return VerifiableCredentialFormat.JWT_VC_JSON;
	} catch (error) {
		logger.debug('Failed to parse credential as JWT for format inference', { error });
	}

	try {
		const bytes = Uint8Array.from(atob(credential.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
		if (
			(bytes[0] === 0xA2 && bytes[1] === 0x6A) ||
			(bytes[0] === 0xB9 && bytes[1] === 0x00)
		) {
			return VerifiableCredentialFormat.MSO_MDOC;
		}
	} catch (error) {
		logger.debug('Failed to parse credential as MSO for format inference', { error });
	}

	throw new Error('Unable to infer credential format');
}

export default useOID4VCIFlow;
