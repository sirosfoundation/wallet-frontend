import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '@/logger';
import { OIDFlowError } from '@/lib/openid-flow/errors';
import { OIDFlowCallbackURL, OIDFlowProgressEvent } from '@/lib/openid-flow/types/OIDFlowTypes';
import useErrorDialog from '@/hooks/useErrorDialog';
import useOID4VCIFlow from '@/hooks/useOID4VCIFlow';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import useOID4VPFlow from '@/hooks/useOID4VPFlow';
import { useTxCodeInput } from '@/context/TxCodeInputContext';
import { TxCodeConfig, TxCodeInputPopup } from '@/components/Popups/TxCodeInputPopup';
import MessagePopup from '@/components/Popups/MessagePopup';
import Spinner from '@/components/Shared/Spinner';
import { useOIDFlowTransport } from '@/context/OIDFlowTransportContext';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '@/context/TenantContext';
import { parseOIDFlowCallbackUrl } from '@/lib/openid-flow/utils/oidFlowCallbackUrl';
import { DisplayErrorFunction } from '@/context/ErrorDialogContext';
import { TFunction } from 'i18next';


const OpenIDFlowCallback: React.FC = () => {
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();
	const { requestTxCode, state: txCodeState, handleSubmit: handleTxCodeSubmit, handleCancel: handleTxCodeCancel } = useTxCodeInput();
	const { showCredentialSelectionPopup, showTransactionDataConsentPopup } = useContext(OpenID4VPContext);
	const [vpSuccessMessage, setVpSuccessMessage] = useState<{ title: string; description: string } | null>(null);
	const { transportReady } = useOIDFlowTransport();
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	const flowIsActive = useRef(false);

	/**
	 * Parse the callback URL on initial load to determine the flow type and relevant parameters.
	 */
	const callbackUrl: OIDFlowCallbackURL = useMemo(() => {
		const url = new URL(window.location.href);

		return parseOIDFlowCallbackUrl(url);
	}, []);

	const navigateHome = useCallback(() => {
		navigate(buildPath());
	}, [navigate, buildPath]);

	/**
	 * Handle erros thrown during OID4VCI flows.
	 */
	const handleOID4VCIError = useCallback((err: Error) => {
		logger.error('Error in OID4VCI flow:', err);
		displayError({
			title: 'OID4VCI Flow Error',
			description: err instanceof Error ? err.message : String(err),
		});
	}, [displayError]);

	/**
	 * Handle OID4VCI flow progress events.
	 * For now, just debug logging.
	 */
	const handleOID4VCIProgress = useCallback((event: OIDFlowProgressEvent) => {
		logger.debug('OID4VCI flow progress:', event);
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
	const handleOID4VPProgress = useCallback((event: OIDFlowProgressEvent) => {
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


	// Kick off the appropriate flow handler based on the callback URL
	useEffect(() => {
		if (!transportReady || flowIsActive.current) return;
		flowIsActive.current = true;

		logger.debug("Processing OpenID callback URL:", callbackUrl);

		const vciHandler = new OID4VCIFlowHandler(
			{
				transportType: vciTransportType,
				handleCredentialOffer,
				handleReceivedCredentials,
				requestWithPreAuthorization,
				handleAuthorizationResponse,
			},
			{
				requestTxCode,
				displayError,
				navigateHome,
			}
		);

		const vpHandler = new OID4VPFlowHandler(
			{
				transportType: vpTransportType,
				handleAuthorizationRequest,
				handleCredentialSelection,
				sendAuthorizationResponse,
			},
			{
				showTransactionDataConsentPopup,
				displayError,
				navigateHome,
				setVpSuccessMessage,
				t,
			}
		);

		switch (callbackUrl.protocol) {
			case 'oid4vci':
				vciHandler.run(callbackUrl);
				break;
			case 'oid4vp':
				vpHandler.run(callbackUrl);
				break;
			case 'unknown':
				if (callbackUrl.type === 'authorization_error') {
					const error = callbackUrl.url.searchParams.get('error');
					const desc = callbackUrl.url.searchParams.get('error_description');
					window.history.replaceState({}, '', window.location.origin + window.location.pathname);

					displayError({
						title: error ?? 'Authorization Error',
						description: desc ?? '',
						onClose: () => navigate(buildPath()),
					});

					return;
				}
				// falls through to default intentionally if not authorization_error
			default:
				logger.error("Unsupported callback URL protocol:", callbackUrl.protocol);
				displayError({
					title: 'Unsupported Callback',
					description: 'The provided callback URL is not supported.',
					onClose: () => navigateHome(),
				});

				return;
		}
	}, [
		callbackUrl,
		transportReady,
		displayError,
		navigate,
		buildPath,
		navigateHome,
	]);

	return (
		<>
			<Spinner/>
			{vpSuccessMessage && (
				<MessagePopup
					type="success"
					onClose={() => { setVpSuccessMessage(null); navigateHome(); }}
					message={vpSuccessMessage}
				/>
			)}
			<TxCodeInputPopup
				isOpen={txCodeState.isOpen}
				txCodeConfig={txCodeState.config}
				onSubmit={handleTxCodeSubmit}
				onCancel={() => {
					handleTxCodeCancel();
					navigateHome();
				}}
			/>
		</>
	);
};

type VCIFlowPrimitives = Pick<
	ReturnType<typeof useOID4VCIFlow>,
	'handleCredentialOffer' | 'handleReceivedCredentials' | 'requestWithPreAuthorization' | 'handleAuthorizationResponse' | 'transportType'
>;

type VCIFlowUIDeps = {
	requestTxCode: (config: TxCodeConfig) => Promise<string>;
	displayError: DisplayErrorFunction;
	navigateHome: () => void;
};

class OID4VCIFlowHandler {
	readonly #flow: VCIFlowPrimitives;
	readonly #ui: VCIFlowUIDeps;

	constructor(flow: VCIFlowPrimitives, ui: VCIFlowUIDeps) {
		this.#flow = flow;
		this.#ui = ui;
	}

	async run(callbackUrl: OIDFlowCallbackURL): Promise<void> {
		if (callbackUrl.protocol !== 'oid4vci') return;

		try {
			if (this.#flow.transportType === 'none') {
				throw new OIDFlowError({ code: 'NO_TRANSPORT', message: '...' });
			}

			switch (callbackUrl.type) {
				case 'credential_offer':
					await this.#handleCredentialOffer(callbackUrl.url);
					break;
				case 'authorization_code':
					await this.#handleAuthorizationCode(callbackUrl.url);
					break;
				default:
					throw new OIDFlowError({ code: 'UNSUPPORTED_CALLBACK', message: '...' });
			}

			this.#ui.navigateHome();
		} catch (error) {
			logger.error("Error in OID4VCI flow:", error);
			this.#ui.displayError({
				title: "OID4VCI Flow Error",
				description: error instanceof Error ? error.message : String(error),
				onClose: () => this.#ui.navigateHome(),
			});
		}
	}

	async #handleCredentialOffer(url: URL) {
		const offer = await this.#flow.handleCredentialOffer(url);
		logger.debug("Received credential offer:", offer);

		cleanupUrl();

		if (offer.success && offer.credentials?.length) {
			logger.debug("Credential offer included credentials, handling them directly...");
			const handleResult = await this.#flow.handleReceivedCredentials(
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

		if (!offer.preAuthorizedCode) return;

		let txCodeInput: string | undefined;

		if (offer.txCode) {
			try {
				txCodeInput = await this.#ui.requestTxCode({
					description: offer.txCode.description ?? undefined,
					length: offer.txCode.length ?? undefined,
					inputMode: offer.txCode.inputMode === 'numeric' ? 'numeric' : 'text',
				});
			} catch {
				logger.info("User cancelled transaction code input");
				return;
			}
		}

		const preAuthResult = await this.#flow.requestWithPreAuthorization(
			offer.preAuthorizedCode,
			txCodeInput,
		);
		logger.debug("Pre-authorization request handled:", preAuthResult);

		if (preAuthResult.success && preAuthResult.credentials?.length) {
			const handleResult = await this.#flow.handleReceivedCredentials(
				preAuthResult.credentials,
				preAuthResult.credentialIssuerIdentifier,
				preAuthResult.selectedCredentialConfigurationId,
			);
			logger.debug("Credentials handled:", handleResult);
		}
	}

	async #handleAuthorizationCode(url: URL) {
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		cleanupUrl();

		const authResResult = await this.#flow.handleAuthorizationResponse(code, state);
		logger.debug("Authorization response handled:", authResResult);

		if (authResResult.success && authResResult.credentials?.length) {
			const handleResult = await this.#flow.handleReceivedCredentials(
				authResResult.credentials,
				authResResult.credentialIssuerIdentifier,
				authResResult.selectedCredentialConfigurationId,
			);
			logger.debug("Credentials handled:", handleResult);
		}
	}
}

type VPFlowPrimitives = Pick<
	ReturnType<typeof useOID4VPFlow>,
	'handleAuthorizationRequest' | 'handleCredentialSelection' | 'sendAuthorizationResponse' | 'transportType'
>;

type VPFlowUIDeps = {
	showTransactionDataConsentPopup: React.ContextType<typeof OpenID4VPContext>['showTransactionDataConsentPopup'];
	displayError: DisplayErrorFunction;
	navigateHome: () => void;
	setVpSuccessMessage: React.Dispatch<React.SetStateAction<{ title: string; description: string } | null>>;
	t: TFunction;
};

class OID4VPFlowHandler {
	readonly #flow: VPFlowPrimitives;
	readonly #ui: VPFlowUIDeps;

	constructor(flow: VPFlowPrimitives, ui: VPFlowUIDeps) {
		this.#flow = flow;
		this.#ui = ui;
	}

	async run(callbackUrl: OIDFlowCallbackURL): Promise<void> {
		if (callbackUrl.protocol !== 'oid4vp') return;

		try {
			if (this.#flow.transportType === 'none') {
				throw new OIDFlowError({ code: 'NO_TRANSPORT', message: '...' });
			}

			switch (callbackUrl.type) {
				case 'presentation_request':
					await this.#handleAuthorizationRequest(callbackUrl.url);
					break;
				default:
					throw new OIDFlowError({ code: 'UNSUPPORTED_CALLBACK', message: '...' });
			}

			this.#ui.navigateHome();
		} catch (error) {
			logger.error("Error in OID4VP flow:", error);
			this.#ui.displayError({
				title: "OID4VP Flow Error",
				description: error instanceof Error ? error.message : String(error),
				onClose: () => this.#ui.navigateHome(),
			});
		}
	}

	async #handleAuthorizationRequest(url: URL) {
		const result = await this.#flow.handleAuthorizationRequest(url);

		cleanupUrl();

		if (!result?.success) {
			throw new OIDFlowError(result.error);
		}

		logger.debug("Authorization request result:", result);

		if (result.transactionData?.length) {
			const consented = await this.#ui.showTransactionDataConsentPopup({
				title: 'Transaction Data',
				attestations: result.transactionData.map(td => td.data),
			});

			if (!consented) return;
		}

		const credSelectResult = await this.#flow.handleCredentialSelection(
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

		const sendResult = await this.#flow.sendAuthorizationResponse(
			credSelectResult.selectedCredentials
		);
		logger.debug("Authorization response sent:", sendResult);

		if (sendResult.success) {
			this.#ui.setVpSuccessMessage({
				title: this.#ui.t('messagePopup.sendResponseSuccess.title'),
				description: this.#ui.t('messagePopup.sendResponseSuccess.description'),
			});
		}

		if ('redirectUri' in sendResult) {
			window.location.href = sendResult.redirectUri;
			return;
		}

	}
}

function cleanupUrl() {
	window.history.replaceState({}, '', window.location.origin + window.location.pathname);
}

export default OpenIDFlowCallback;
