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
import useOID4VPFlow from "@/hooks/useOID4VPFlow";
import OpenID4VPContext from "@/context/OpenID4VPContext";
import MessagePopup from "@/components/Popups/MessagePopup";
import { OIDFlowError } from "@/lib/transport/errors";
import { useFlowTransport } from "@/context/FlowTransportContext";


export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);
	const { requestTxCode, state: txCodeState, handleSubmit: handleTxCodeSubmit, handleCancel: handleTxCodeCancel } = useTxCodeInput();
	const { displayError } = useErrorDialog();

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const [usedAuthorizationCodes, setUsedAuthorizationCodes] = useState<string[]>([]);
	// const [usedRequestUris, setUsedRequestUris] = useState<string[]>([]);
	// const [usedPreAuthorizedCodes, setUsedPreAuthorizedCodes] = useState<string[]>([]);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { transportReady } = useFlowTransport();
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	const [url, setUrl] = useState(window.location.href);

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const { openID4VCI } = useContext(OpenID4VCIContext);
	const { showCredentialSelectionPopup, showTransactionDataConsentPopup } = useContext(OpenID4VPContext);

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const { handleCredentialOffer, generateAuthorizationRequest, handleAuthorizationResponse, requestCredentialsWithPreAuthorization } = openID4VCI;
	// const { handleAuthorizationRequest, promptForCredentialSelection, sendAuthorizationResponse } = openID4VP;

	// TODO: remove these once basic VCI and VP flows are integrated and working.
	// const [showPinInputPopup, setShowPinInputPopup] = useState<boolean>(false);

	// TODO: move this to a new HOC, responsible for session initialization and syncing.
	const [vpSuccessMessage, setVpSuccessMessage] = useState<{ title: string; description: string } | null>(null);
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
	}, [displayError]);

	/**
	 * Handle OID4VCI flow progress events.
	 * For now, just debug logging.
	 */
	const handleOID4VCIProgress = useCallback((event: FlowProgressEvent) => {
		logger.debug("OID4VCI flow progress:", event);
	}, []);

	/**
	 * Handle warnings during credential issuance in OID4VCI flows.
	 *
	 * @todo Use a actual popup component here instead of ugly browser confirm()
	 */
	const handleOID4VCIIssuanceWarnings = useCallback(async (warnings: Array<{ code: string }>) => {
		logger.warn('Credential issuance warnings:', warnings);
		const codes = warnings.map(w => w.code).join(', ');
		return window.confirm(`Credential has warning(s): ${codes}. Proceed anyway?`);
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
	 * Handle errors thrown during OID4VP flows.
	 */
	const handleOID4VPError = useCallback((err: Error) => {
		logger.error("Error in OID4VP flow:", err);
		if (!(err instanceof OIDFlowError)) {
			displayError({
				title: t('messagePopup.vpFlowError.title', 'Verification Error'),
				description: err.message,
			});
			return;
		}

		switch (err.code) {
			case 'INSUFFICIENT_CREDENTIALS':
				displayError({
					title: t('messagePopup.insufficientCredentials.title'),
					description: t('messagePopup.insufficientCredentials.description'),
				});
				return;
			case 'NONTRUSTED_VERIFIER':
				displayError({
					title: t('messagePopup.nonTrustedVerifier.title'),
					description: t('messagePopup.nonTrustedVerifier.description'),
				});
				return;
			default:
				displayError({
					title: t('messagePopup.vpFlowError.title', 'Verification Error'),
					description: err.message,
				});
				return;
		}
	}, [displayError, t]);

	/**
	 * Handle OID4VP flow progress events.
	 * For now, just debug logging.
	 */
	const handleOID4VPProgress = useCallback((event: FlowProgressEvent) => {
		logger.debug("OID4VP flow progress:", event);
	}, []);

	/**
	 * Handle credential selection during OID4VP flows by showing the configured UI and returning the user's selection.
	 */
	const handleOID4VPCredentialSelection = useCallback(async (
		conformantCredentialsMap: Record<string, {
			credentials: number[];
			requestedFields: Array<{
				name?: string;
			}>;
		}>,
		verifierDomainName: string,
		verifierPurpose: string,
	) => {
		logger.debug("Prompting for credential selection...", { conformantCredentialsMap, verifierDomainName, verifierPurpose });

		if (!showCredentialSelectionPopup) {
			throw new Error('No credential selection popup configured');
		}

		const selection = await showCredentialSelectionPopup(
			conformantCredentialsMap,
			verifierDomainName,
			verifierPurpose,
		);

		logger.debug("User selection:", selection);

		return selection;
	}, [showCredentialSelectionPopup]);

	const {
		transportType: vpTransportType,
		isLoading: vpIsLoading,
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
	} = useOID4VPFlow({
		onError: handleOID4VPError,
		onProgress: handleOID4VPProgress,
		onCredentialSelection: handleOID4VPCredentialSelection,
	});

	/**
	 * Combined loading state for any OID4VCI or OID4VP flow in progress.
	 */
	const isLoading = useMemo(() => vciIsLoading || vpIsLoading, [vciIsLoading, vpIsLoading]);

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

	/**
	 * Returns current url if it contains authorization error parameters (error and state) after redirection.
	 */
	const urlWithAuthorizationError: URL | null = useMemo(() => {
		const u = new URL(url);
		if (u.searchParams.get('state') && u.searchParams.get('error')) return u;
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
	 * Handle urls that contain auth error params.
	 */
	useEffect(() => {
	if (!isLoggedIn || !synced) return;

	if (urlWithAuthorizationError) {
		const error = urlWithAuthorizationError.searchParams.get('error');
		const errorDescription = urlWithAuthorizationError.searchParams.get('error_description');

		const cleanUrl = window.location.origin + window.location.pathname;
		window.history.replaceState({}, '', cleanUrl);
		setUrl(cleanUrl);

		displayError({ title: error ?? 'Error', description: errorDescription ?? '' });
	}
	}, [isLoggedIn, synced, urlWithAuthorizationError, displayError]);

	/**
	 * OpenID4VCI flow entrypoint.
	 */
	useEffect(() => {
		if (!isLoggedIn || !synced || vciTransportType === 'none' || isLoading || !transportReady) return;

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
		displayError,
		vciTransportType,
		urlWithCredentialOffer,
		urlWithAuthorizationCode,
		isLoading,
		transportReady,
	]);

	/**
	 * OpenID4VP flow entrypoint.
	 */
	useEffect(() => {
		if (!isLoggedIn || !synced || vpTransportType === 'none' || isLoading || !transportReady) return;

		if (urlWithAuthorizationRequest) {
			(async () => {
				try {
					const result = await handleAuthorizationRequest(urlWithAuthorizationRequest);

					const cleanUrl = window.location.origin + window.location.pathname;
					window.history.replaceState({}, '', cleanUrl);
					setUrl(cleanUrl);

					if (!result?.success) {
						throw new OIDFlowError(result.error);
					}

					logger.debug("Authorization request result:", result);

					if (result.transactionData?.length) {
						const consented = await showTransactionDataConsentPopup({
							title: 'Transaction Data',
							attestations: result.transactionData.map(td => td.data),
						});

						if (!consented) return;
					}

					const credSelectResult = await handleCredentialSelection(
						result.verifierInfo,
						result.dcqlQuery,
						result.conformantCredentials,
					);

					if (!credSelectResult?.success) {
						if (credSelectResult?.error?.code === 'USER_CANCELLED') {
							return; // User dismissed popup
						}

						throw new OIDFlowError(credSelectResult.error);
					}

					const sendResult = await sendAuthorizationResponse(
						credSelectResult.selectedCredentials
					);
					logger.debug("Authorization response sent:", sendResult);

					if (sendResult.success) {
						setVpSuccessMessage({
							title: t('messagePopup.sendResponseSuccess.title'),
							description: t('messagePopup.sendResponseSuccess.description'),
						});
					}

					if ('redirectUri' in sendResult) {
						window.location.href = sendResult.redirectUri;
						return;
					}
				} catch (error) {
					if (error instanceof OIDFlowError) {
						logger.error(`OIDFlowError [${error.code}]: ${error.message}`);
					} else {
						logger.error("Error handling authorization request:", error);
					}
					const cleanUrl = window.location.origin + window.location.pathname;
					window.history.replaceState({}, '', cleanUrl);
					setUrl(cleanUrl);
				}
			})();
		}
	}, [
		t,
		isLoggedIn,
		synced,
		vpTransportType,
		isLoading,
		urlWithAuthorizationRequest,
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
		showTransactionDataConsentPopup,
		transportReady,
	]);

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
			{vpSuccessMessage && (
				<MessagePopup
					type="success"
					onClose={() => setVpSuccessMessage(null)}
					message={vpSuccessMessage}
				/>
			)}
			<TxCodeInputPopup
				isOpen={txCodeState.isOpen}
				txCodeConfig={txCodeState.config}
				onSubmit={handleTxCodeSubmit}
				onCancel={handleTxCodeCancel}
			/>
		</Suspense>
	);
}
