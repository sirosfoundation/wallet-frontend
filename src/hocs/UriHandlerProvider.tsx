import React, { useEffect, useState, useContext, Suspense, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import StatusContext from "../context/StatusContext";
import { logger } from "@/logger";
import SessionContext from "../context/SessionContext";
import { useTranslation } from "react-i18next";
import { CachedUser } from "@/services/LocalStorageKeystore";
import SyncPopup from "@/components/Popups/SyncPopup";
import { useSessionStorage } from "@/hooks/useStorage";
import { useTxCodeInput } from "@/context/TxCodeInputContext";
import TxCodeInputPopup from "@/components/Popups/TxCodeInputPopup";
import useErrorDialog from "@/hooks/useErrorDialog";
import useOID4VCIFlow from "@/hooks/useOID4VCIFlow";
import { FlowProgressEvent } from "@/lib/transport";
import Spinner from "@/components/Shared/Spinner";


export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);
	const { requestTxCode, state: txCodeState, handleSubmit: handleTxCodeSubmit, handleCancel: handleTxCodeCancel } = useTxCodeInput();
	const { displayError } = useErrorDialog();

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const [usedAuthorizationCodes, setUsedAuthorizationCodes] = useState<string[]>([]);
	// const [usedRequestUris, setUsedRequestUris] = useState<string[]>([]);
	// const [usedPreAuthorizedCodes, setUsedPreAuthorizedCodes] = useState<string[]>([]);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	const [url, setUrl] = useState(window.location.href);

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const { openID4VCI } = useContext(OpenID4VCIContext);
	// const { openID4VP } = useContext(OpenID4VPContext);

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const { handleCredentialOffer, generateAuthorizationRequest, handleAuthorizationResponse, requestCredentialsWithPreAuthorization } = openID4VCI;
	// const { handleAuthorizationRequest, promptForCredentialSelection, sendAuthorizationResponse } = openID4VP;

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const [showPinInputPopup, setShowPinInputPopup] = useState<boolean>(false);

	// TODO: move this to a new HOC, responsible for session initialization and syncing.
	const [showSyncPopup, setSyncPopup] = useState<boolean>(false);
	const [textSyncPopup, setTextSyncPopup] = useState<{ description: string }>({ description: "" });

	const { t } = useTranslation();

	// TODO: move this to a new HOC, responsible for session initialization and syncing.
	const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
	const [synced, setSynced] = useState(false);
	const [latestIsOnlineStatus, setLatestIsOnlineStatus,] = api.useClearOnClearSession(useSessionStorage('latestIsOnlineStatus', null));


	/**
	 * Handle erros thrown during OID4VCI flows.
	 */
	const handleOID4VCIError = useCallback((err: Error) => {
		logger.error("Error in OID4VCI flow:", err);
		displayError({
			title: "OID4VCI Flow Error",
			description: err instanceof Error ? err.message : String(err),
		});
	}, [logger, displayError]);

	/**
	 * Handle OID4VCI flow progress events.
	 * For now, just debug logging.
	 */
	const handleOID4VCIProgress = useCallback((event: FlowProgressEvent) => {
		logger.debug("OID4VCI flow progress:", event);
	}, [logger]);

	/**
	 * Handle warnings during credential issuance in OID4VCI flows.
	 *
	 * @todo Use a actual popup component here instead of ugly browser confirm()
	 */
	const handleOID4VCIIssuanceWarnings = useCallback(async (warnings: Array<{ code: string }>) => {
		logger.warn('Credential issuance warnings:', warnings);
		const codes = warnings.map(w => w.code).join(', ');
		return confirm(`Credential has warning(s): ${codes}. Proceed anyway?`);
	}, []);

	const {
		transportType: vciTransportType,
		isLoading: vciIsLoading,
		handleCredentialOffer,
		requestWithPreAuthorization,
		handleAuthorizationResponse,
		handleReceivedCredentials,
	} = useOID4VCIFlow({
		onError: handleOID4VCIError,
		onProgress: handleOID4VCIProgress,
		onIssuanceWarnings: handleOID4VCIIssuanceWarnings,
	});

	/**
	 * Combined loading state for any OID4VCI or OID4VP flow in progress.
	 */
	const isLoading = useMemo(() => vciIsLoading, [vciIsLoading]);

	/**
	 * Returns current url if it contains a credential offer.
	 */
	const urlWithCredentialOffer: URL | null = useMemo(() => {
		const u = new URL(url);
		if (
			u.protocol === 'openid-credential-offer:' ||
			u.searchParams.get('credential_offer') ||
			u.searchParams.get('credential_offer_uri')
		) return u;

		return null;
	}, [url]);

	/**
	 * Returns current url if it contains an authorization code from the authorization server after user consent.
	 */
	const urlWithAuthorizationCode: URL | null = useMemo(() => {
		const u = new URL(url);
		if (u.searchParams.get('code')) return u;

		return null;
	}, [url]);

	/**
	 * Returns current url if it contains an OID4VP authorization request (client_id and request_uri parameters)
	 * indicating the start of a verifiable presentation flow.
	 */
	const urlWithAuthorizationRequest: URL | null = useMemo(() => {
		const u = new URL(url);
		if (u.searchParams.get('client_id') && u.searchParams.get('request_uri')) return u;

		return null;
	}, [url]);

	// TODO: move this to a new HOC, responsible for session initialization and syncing,
	// that would wrap around the UriHandlerProvider.
	useEffect(() => {
		if (!keystore || cachedUser !== null || !isLoggedIn) {
			return;
		}

		const userHandle = getUserHandleB64u();
		if (!userHandle) {
			return;
		}
		const u = getCachedUsers().filter((user) => user.userHandleB64u === userHandle)[0];
		if (u) {
			setCachedUser(u);
		}
	}, [keystore, getCachedUsers, getUserHandleB64u, setCachedUser, cachedUser, isLoggedIn]);

	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (window.location.search !== '' && params.get('sync') !== 'fail') {
			setSynced(false);
		}
	}, [location]);

	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		if (latestIsOnlineStatus === false && isOnline === true && cachedUser) {
			api.syncPrivateData(cachedUser);
		}
		if (isLoggedIn) {
			setLatestIsOnlineStatus(isOnline);
		} else {
			setLatestIsOnlineStatus(null);
		}
	}, [
		api,
		isLoggedIn,
		isOnline,
		latestIsOnlineStatus,
		setLatestIsOnlineStatus,
		cachedUser
	]);

	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		if (!getCalculatedWalletState || !cachedUser || !syncPrivateData) {
			return;
		}
		const params = new URLSearchParams(location.search);
		if (synced === false && getCalculatedWalletState() && params.get('sync') !== 'fail') {
			logger.debug("Actually syncing...");
			(async () => {
				const r = await syncPrivateData(cachedUser);
				if (!r.ok) {
					return;
				}
				setSynced(true);
			})();
		}

	}, [cachedUser, synced, setSynced, getCalculatedWalletState, syncPrivateData, location.search]);

	useEffect(() => {
		if (synced === true && window.location.search !== '') {
			setUrl(window.location.href);
		}
	}, [synced, setUrl, location]);

	/**
	 * OpenID4VCI flow entrypoint.
	 */
	useEffect(() => {
		if (!isLoggedIn || !synced || vciTransportType === 'none' || isLoading) return;

		if (urlWithCredentialOffer) {
			(async () => {
				const offer = await handleCredentialOffer(urlWithCredentialOffer);
				logger.debug("Received credential offer:", offer);

				const cleanUrl = window.location.origin + window.location.pathname;
				window.history.replaceState({}, '', cleanUrl);
				setUrl(cleanUrl);

				if (offer.success && offer.credentials?.length) {
					logger.debug("Credential offer included credentials, handling them directly...");
					const handleResult = await handleReceivedCredentials(
						offer.credentials,
						offer.credentialIssuerIdentifier,
						offer.selectedCredentialConfigurationId,
					);
					logger.debug("Credentials handled:", handleResult);
				}

				if (offer.authorizationUrl) {
					window.location.href = offer.authorizationUrl;
					return;
				}

				if (offer.preAuthorizedCode) {
					let txCodeInput: string | undefined;

					if (offer.txCode) {
						try {
							txCodeInput = await requestTxCode({
								description: offer.txCode.description ?? undefined,
								length: offer.txCode.length ?? undefined,
								inputMode: offer.txCode.inputMode === 'numeric' ? 'numeric' : 'text',
							});
						} catch (err) {
							logger.info("User cancelled transaction code input");
							return;
						}
					}

					try {
						const preAuthResult = await requestWithPreAuthorization(
							offer.preAuthorizedCode,
							txCodeInput,
						);
						logger.debug("Pre-authorization request handled:", preAuthResult);

						if (preAuthResult.success && preAuthResult.credentials?.length) {
							const handleResult = await handleReceivedCredentials(
								preAuthResult.credentials,
								preAuthResult.credentialIssuerIdentifier,
								preAuthResult.selectedCredentialConfigurationId,
							);
							logger.debug("Credentials handled:", handleResult);
						}
					} catch (error) {
						logger.error('Error in pre-authorized flow:', error);
						displayError({
							title: "Pre-Authorized Flow Error",
							description: error instanceof Error ? error.message : String(error),
						});
						return;
					}

				}
			})();
		}

		if (urlWithAuthorizationCode) {
			(async () => {
				const code = urlWithAuthorizationCode.searchParams.get('code');
				const state = urlWithAuthorizationCode.searchParams.get('state');

				const cleanUrl = window.location.origin + window.location.pathname;
				window.history.replaceState({}, '', cleanUrl);
				setUrl(cleanUrl);

				try {
					const authResResult = await handleAuthorizationResponse(code, state);
					logger.debug("Authorization response handled:", authResResult);

					if (authResResult.success && authResResult.credentials?.length) {
						const handleResult = await handleReceivedCredentials(
							authResResult.credentials,
							authResResult.credentialIssuerIdentifier,
							authResResult.selectedCredentialConfigurationId,
						);
						logger.debug("Credentials handled:", handleResult);
					}
				} catch (error) {
					logger.error("Error handling authorization response:", error);
				}
			})();
		}
	}, [
		isLoggedIn,
		synced,
		keystore,
		api,
		handleCredentialOffer,
		handleAuthorizationResponse,
		requestWithPreAuthorization,
		requestTxCode,
		handleReceivedCredentials,
		vciTransportType,
		urlWithCredentialOffer,
		urlWithAuthorizationCode,
		isLoading,
	]);

	// OLD IMPLEMENTATION - KEEP FOR REFERENCE
	//
	// TODO: remove it once basic VCI and VP flows are integrated and working
	//
	// useEffect(() => {
	// 	if (
	// 		!isLoggedIn || !url || !t || !vcEntityList || !synced ||
	// 		!handleCredentialOffer || !generateAuthorizationRequest || !handleAuthorizationResponse ||
	// 		!handleAuthorizationRequest || !promptForCredentialSelection || !sendAuthorizationResponse
	// 	) return;

	// 	async function handle(urlToCheck: string) {
	// 		const u = new URL(urlToCheck);
	// 		if (u.searchParams.size === 0) return;
	// 		// setUrl(window.location.origin);
	// 		logger.debug('[Uri Handler]: check', u.toString());

	// 		if (u.protocol === 'openid-credential-offer' || u.searchParams.get('credential_offer') || u.searchParams.get('credential_offer_uri')) {
	// 			// Handle credential offer with async/await for proper React state updates
	// 			(async () => {
	// 				try {
	// 					const offer = await handleCredentialOffer(u.toString());
	// 					const { credentialIssuer, selectedCredentialConfigurationId, issuer_state, preAuthorizedCode, txCode } = offer;

	// 					logger.debug("Handling credential offer...", { credentialIssuer, preAuthorizedCode: !!preAuthorizedCode });

	// 					if (!preAuthorizedCode) {
	// 						// Authorization code flow - redirect to authorization
	// 						logger.debug("Generating authorization request...");
	// 						const authResult = await generateAuthorizationRequest(credentialIssuer, selectedCredentialConfigurationId, issuer_state);
	// 						if ('url' in authResult && typeof authResult.url === 'string' && authResult.url) {
	// 							window.location.href = authResult.url;
	// 						}
	// 						return;
	// 					}

	// 					// Check for pre-authorized code replay
	// 					if (usedPreAuthorizedCodes.includes(preAuthorizedCode)) {
	// 						logger.debug("Already used pre-authorized code, ignoring");
	// 						return;
	// 					}
	// 					setUsedPreAuthorizedCodes((codes) => [...codes, preAuthorizedCode]);

	// 					// Pre-authorized code flow
	// 					let userInput: string | undefined = undefined;
	// 					if (txCode) {
	// 						try {
	// 							// Use React popup instead of blocking prompt()
	// 						const rawTxCode = txCode as RawTxCodeSpec;
	// 							userInput = await requestTxCode({
	// 								description: rawTxCode.description ?? undefined,
	// 								length: rawTxCode.length ?? undefined,
	// 								inputMode: rawTxCode.input_mode === 'numeric' ? 'numeric' : 'text',
	// 							});
	// 						} catch (err) {
	// 							// User cancelled tx code input
	// 							logger.info("User cancelled transaction code input");
	// 							window.history.replaceState({}, '', `${window.location.pathname}`);
	// 							return;
	// 						}
	// 					}

	// 					logger.debug("Requesting credential with pre-authorization...");
	// 					const maxTxCodeRetries = 3;
	// 					for (let attempt = 0; attempt <= maxTxCodeRetries; attempt++) {
	// 						try {
	// 							const result = await requestCredentialsWithPreAuthorization(
	// 								credentialIssuer,
	// 								selectedCredentialConfigurationId,
	// 								preAuthorizedCode,
	// 								userInput
	// 							);

	// 							if ('url' in result && typeof result.url === 'string' && result.url) {
	// 								window.location.href = result.url;
	// 							}
	// 							break;
	// 						} catch (retryErr) {
	// 							if (retryErr instanceof InvalidTxCodeError && txCode && attempt < maxTxCodeRetries) {
	// 								logger.info("Invalid transaction code, prompting for retry");
	// 								try {
	// 									const rawTxCode = txCode as RawTxCodeSpec;
	// 									userInput = await requestTxCode({
	// 										description: t('txCodeInput.errorInvalid'),
	// 										length: rawTxCode.length ?? undefined,
	// 										inputMode: rawTxCode.input_mode === 'numeric' ? 'numeric' : 'text',
	// 									});
	// 								} catch (_cancelErr) {
	// 									logger.info("User cancelled transaction code retry");
	// 									window.history.replaceState({}, '', `${window.location.pathname}`);
	// 									return;
	// 								}
	// 								continue;
	// 							}
	// 							throw retryErr;
	// 						}
	// 					}
	// 				} catch (err) {
	// 					window.history.replaceState({}, '', `${window.location.pathname}`);
	// 					logger.error("Error handling credential offer:", err);
	// 				}
	// 			})();
	// 			return;
	// 		}
	// 		else if (u.searchParams.get('code') && !usedAuthorizationCodes.includes(u.searchParams.get('code'))) {
	// 			setUsedAuthorizationCodes((codes) => [...codes, u.searchParams.get('code')]);

	// 			logger.debug("Handling authorization response...");
	// 			(async () => {
	// 				try {
	// 					await handleAuthorizationResponse(u.toString());
	// 				} catch (err) {
	// 					logger.error("Error during the handling of authorization response:", err);
	// 					window.history.replaceState({}, '', `${window.location.pathname}`);
	// 				}
	// 			})();
	// 		}
	// 		else if (u.searchParams.get('client_id') && u.searchParams.get('request_uri') && !usedRequestUris.includes(u.searchParams.get('request_uri'))) {
	// 			setUsedRequestUris((uriArray) => [...uriArray, u.searchParams.get('request_uri')]);

	// 			// Handle OID4VP authorization request with async/await
	// 			(async () => {
	// 				try {
	// 					const result = await handleAuthorizationRequest(u.toString(), vcEntityList);
	// 					logger.debug("Authorization request result:", result);

	// 					if ('error' in result) {
	// 										if (result.error === HandleAuthorizationRequestErrors.INSUFFICIENT_CREDENTIALS) {
	// 							displayError({
	// 								title: t('messagePopup.insufficientCredentials.title'),
	// 								description: t('messagePopup.insufficientCredentials.description')
	// 							});
	// 										} else if (result.error === HandleAuthorizationRequestErrors.NONTRUSTED_VERIFIER) {
	// 							displayError({
	// 								title: t('messagePopup.nonTrustedVerifier.title'),
	// 								description: t('messagePopup.nonTrustedVerifier.description')
	// 							});
	// 						}
	// 						return;
	// 					}

	// 					const { conformantCredentialsMap, verifierDomainName, verifierPurpose, parsedTransactionData } = result;
	// 					const jsonedMap = Object.fromEntries(conformantCredentialsMap);
	// 					logger.debug("Prompting for credential selection...");

	// 					const selection = await promptForCredentialSelection(jsonedMap, verifierDomainName, verifierPurpose, parsedTransactionData);

	// 					if (!(selection instanceof Map)) {
	// 						return;
	// 					}

	// 					logger.debug("User selection:", selection);
	// 					const res = await sendAuthorizationResponse(selection, vcEntityList);

	// 					if (res && 'url' in res && res.url) {
	// 						setRedirectUri(res.url);
	// 					}
	// 				} catch (err) {
	// 					logger.error("Failed to handle authorization request:", err);
	// 					window.history.replaceState({}, '', `${window.location.pathname}`);
	// 				}
	// 			})();
	// 			return;
	// 		}

	// 		const urlParams = new URLSearchParams(window.location.search);
	// 		const state = urlParams.get('state');
	// 		const error = urlParams.get('error');
	// 		if (url && isLoggedIn && state && error) {
	// 			window.history.replaceState({}, '', `${window.location.pathname}`);
	// 			const errorDescription = urlParams.get('error_description');
	// 			displayError({ title: error, description: errorDescription ?? '' });
	// 		}
	// 	}
	// 	if (getCalculatedWalletState()) {
	// 		handle(url);
	// 	}
	// }, [
	// 	url,
	// 	t,
	// 	isLoggedIn,
	// 	setRedirectUri,
	// 	vcEntityList,
	// 	synced,
	// 	getCalculatedWalletState,
	// 	usedAuthorizationCodes,
	// 	usedRequestUris,
	// 	// depend on methods, not whole context objects
	// 	handleCredentialOffer,
	// 	generateAuthorizationRequest,
	// 	handleAuthorizationResponse,
	// 	handleAuthorizationRequest,
	// 	promptForCredentialSelection,
	// 	sendAuthorizationResponse,
	// 	requestCredentialsWithPreAuthorization,
	// 	requestTxCode,
	// 	displayError,
	// ]);

	// END OF OLD IMPLEMENTATION - KEEP FOR REFERENCE


	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (synced === true && params.get('sync') === 'fail') {
			setSynced(false);
		}
		else if (params.get('sync') === 'fail' && synced === false) {
			setTextSyncPopup({ description: 'syncPopup.description' });
			setSyncPopup(true);
		} else {
			setSyncPopup(false);
		}
	}, [location, t, synced]);

	// TODO: rather than wrapping the whole app, this should be moved to a page
	// component, e.g. /cb, that would be responsible for all
	// OpenID4VCI/VP flows and would be the redirect URI for all OID4VCI/VP interactions.
	return (
		<Suspense fallback={null}>
			{
				isLoading ? (
					<Spinner/>
				) : null
			}
			{children}
			{/* {showPinInputPopup &&
				<PinInputPopup isOpen={showPinInputPopup} setIsOpen={setShowPinInputPopup} />
			} */}
			{showSyncPopup &&
				<SyncPopup message={textSyncPopup}
					onClose={() => {
						setSyncPopup(false);
						logout();
					}}
				/>
			}
			<TxCodeInputPopup
				isOpen={txCodeState.isOpen}
				txCodeConfig={txCodeState.config}
				onSubmit={handleTxCodeSubmit}
				onCancel={handleTxCodeCancel}
			/>
		</Suspense>
	);
}
