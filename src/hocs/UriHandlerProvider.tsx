import React, { useEffect, useState, useContext, Suspense } from "react";
import { useLocation } from "react-router-dom";
import StatusContext from "../context/StatusContext";
import { logger } from "@/logger";
import SessionContext from "../context/SessionContext";
import { useTranslation } from "react-i18next";
import { HandleAuthorizationRequestError } from "wallet-common";
import OpenID4VCIContext from "../context/OpenID4VCIContext";
import OpenID4VPContext from "../context/OpenID4VPContext";
import CredentialsContext from "@/context/CredentialsContext";
import { CachedUser } from "@/services/LocalStorageKeystore";
import SyncPopup from "@/components/Popups/SyncPopup";
import { useSessionStorage } from "@/hooks/useStorage";
import { useTxCodeInput } from "@/context/TxCodeInputContext";
import TxCodeInputPopup from "@/components/Popups/TxCodeInputPopup";
import useErrorDialog from "@/hooks/useErrorDialog";

const PinInputPopup = React.lazy(() => import('../components/Popups/PinInput'));

export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);
	const { requestTxCode, state: txCodeState, handleSubmit: handleTxCodeSubmit, handleCancel: handleTxCodeCancel } = useTxCodeInput();
	const { displayError } = useErrorDialog();

	const [usedAuthorizationCodes, setUsedAuthorizationCodes] = useState<string[]>([]);
	const [usedRequestUris, setUsedRequestUris] = useState<string[]>([]);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	const [url, setUrl] = useState(window.location.href);

	const { openID4VCI } = useContext(OpenID4VCIContext);
	const { openID4VP } = useContext(OpenID4VPContext);

	const { handleCredentialOffer, generateAuthorizationRequest, handleAuthorizationResponse, requestCredentialsWithPreAuthorization } = openID4VCI;
	const { handleAuthorizationRequest, promptForCredentialSelection, sendAuthorizationResponse } = openID4VP;

	const [showPinInputPopup, setShowPinInputPopup] = useState<boolean>(false);

	const [showSyncPopup, setSyncPopup] = useState<boolean>(false);
	const [textSyncPopup, setTextSyncPopup] = useState<{ description: string }>({ description: "" });

	const { t } = useTranslation();

	const [redirectUri, setRedirectUri] = useState(null);
	const { vcEntityList } = useContext(CredentialsContext);

	const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
	const [synced, setSynced] = useState(false);
	const [latestIsOnlineStatus, setLatestIsOnlineStatus,] = api.useClearOnClearSession(useSessionStorage('latestIsOnlineStatus', null));

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

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (window.location.search !== '' && params.get('sync') !== 'fail') {
			setSynced(false);
		}
	}, [location]);

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

	useEffect(() => {
		if (redirectUri) {
			window.location.href = redirectUri;
		}
	}, [redirectUri]);

	useEffect(() => {
		if (
			!isLoggedIn || !url || !t || !vcEntityList || !synced ||
			!handleCredentialOffer || !generateAuthorizationRequest || !handleAuthorizationResponse ||
			!handleAuthorizationRequest || !promptForCredentialSelection || !sendAuthorizationResponse
		) return;

		async function handle(urlToCheck: string) {
			const u = new URL(urlToCheck);
			if (u.searchParams.size === 0) return;
			// setUrl(window.location.origin);
			logger.debug('[Uri Handler]: check', url);

			if (u.protocol === 'openid-credential-offer' || u.searchParams.get('credential_offer') || u.searchParams.get('credential_offer_uri')) {
				// Handle credential offer with async/await for proper React state updates
				(async () => {
					try {
						const offer = await handleCredentialOffer(u.toString());
						const { credentialIssuer, selectedCredentialConfigurationId, issuer_state, preAuthorizedCode, txCode } = offer;

						logger.debug("Handling credential offer...", { credentialIssuer, preAuthorizedCode: !!preAuthorizedCode });

						if (!preAuthorizedCode) {
							// Authorization code flow - redirect to authorization
							logger.debug("Generating authorization request...");
							const authResult = await generateAuthorizationRequest(credentialIssuer, selectedCredentialConfigurationId, issuer_state);
							if ('url' in authResult && typeof authResult.url === 'string' && authResult.url) {
								window.location.href = authResult.url;
							}
							return;
						}

						// Pre-authorized code flow
						let userInput: string | undefined = undefined;
						if (txCode) {
							try {
								// Use React popup instead of blocking prompt()
								// Note: txCode from JSON uses snake_case (input_mode) per OID4VCI spec
								const rawTxCode = txCode as { input_mode?: string; length?: number; description?: string };
								userInput = await requestTxCode({
									description: rawTxCode.description ?? undefined,
									length: rawTxCode.length ?? undefined,
									inputMode: rawTxCode.input_mode === 'numeric' ? 'numeric' : 'text',
								});
							} catch (err) {
								// User cancelled tx code input
								logger.info("User cancelled transaction code input");
								window.history.replaceState({}, '', `${window.location.pathname}`);
								return;
							}
						}

						logger.debug("Requesting credential with pre-authorization...");
						const result = await requestCredentialsWithPreAuthorization(
							credentialIssuer,
							selectedCredentialConfigurationId,
							preAuthorizedCode,
							userInput
						);

						if ('url' in result && typeof result.url === 'string' && result.url) {
							window.location.href = result.url;
						}
					} catch (err) {
						window.history.replaceState({}, '', `${window.location.pathname}`);
						logger.error("Error handling credential offer:", err);
					}
				})();
				return;
			}
			else if (u.searchParams.get('code') && !usedAuthorizationCodes.includes(u.searchParams.get('code'))) {
				setUsedAuthorizationCodes((codes) => [...codes, u.searchParams.get('code')]);

				logger.debug("Handling authorization response...");
				(async () => {
					try {
						await handleAuthorizationResponse(u.toString());
					} catch (err) {
						logger.error("Error during the handling of authorization response:", err);
						window.history.replaceState({}, '', `${window.location.pathname}`);
					}
				})();
			}
			else if (u.searchParams.get('client_id') && u.searchParams.get('request_uri') && !usedRequestUris.includes(u.searchParams.get('request_uri'))) {
				setUsedRequestUris((uriArray) => [...uriArray, u.searchParams.get('request_uri')]);

				// Handle OID4VP authorization request with async/await
				(async () => {
					try {
						const result = await handleAuthorizationRequest(u.toString(), vcEntityList);
						logger.debug("Authorization request result:", result);

						if ('error' in result) {
							if (result.error === HandleAuthorizationRequestError.INSUFFICIENT_CREDENTIALS) {
								displayError({
									title: t('messagePopup.insufficientCredentials.title'),
									description: t('messagePopup.insufficientCredentials.description')
								});
							} else if (result.error === HandleAuthorizationRequestError.NONTRUSTED_VERIFIER) {
								displayError({
									title: t('messagePopup.nonTrustedVerifier.title'),
									description: t('messagePopup.nonTrustedVerifier.description')
								});
							}
							return;
						}

						const { conformantCredentialsMap, verifierDomainName, verifierPurpose, parsedTransactionData } = result;
						const jsonedMap = Object.fromEntries(conformantCredentialsMap);
						logger.debug("Prompting for credential selection...");

						const selection = await promptForCredentialSelection(jsonedMap, verifierDomainName, verifierPurpose, parsedTransactionData);

						if (!(selection instanceof Map)) {
							return;
						}

						logger.debug("User selection:", selection);
						const res = await sendAuthorizationResponse(selection, vcEntityList);

						if (res && 'url' in res && res.url) {
							setRedirectUri(res.url);
						}
					} catch (err) {
						logger.error("Failed to handle authorization request:", err);
						window.history.replaceState({}, '', `${window.location.pathname}`);
					}
				})();
				return;
			}

			const urlParams = new URLSearchParams(window.location.search);
			const state = urlParams.get('state');
			const error = urlParams.get('error');
			if (url && isLoggedIn && state && error) {
				window.history.replaceState({}, '', `${window.location.pathname}`);
				const errorDescription = urlParams.get('error_description');
				displayError({ title: error, description: errorDescription ?? '' });
			}
		}
		if (getCalculatedWalletState()) {
			handle(url);
		}
	}, [
		url,
		t,
		isLoggedIn,
		setRedirectUri,
		vcEntityList,
		synced,
		getCalculatedWalletState,
		usedAuthorizationCodes,
		usedRequestUris,
		// depend on methods, not whole context objects
		handleCredentialOffer,
		generateAuthorizationRequest,
		handleAuthorizationResponse,
		handleAuthorizationRequest,
		promptForCredentialSelection,
		sendAuthorizationResponse,
		requestCredentialsWithPreAuthorization,
		requestTxCode,
		displayError,
	]);

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

	return (
		<Suspense fallback={null}>
			{children}
			{showPinInputPopup &&
				<PinInputPopup isOpen={showPinInputPopup} setIsOpen={setShowPinInputPopup} />
			}
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
