import { IOpenID4VP } from "../../interfaces/IOpenID4VP";
import {
	HandleAuthorizationRequestError as HandleAuthorizationRequestErrorType,
} from "wallet-common";
import type { OpenID4VPServerCredential } from "wallet-common";
import { OpenID4VPServerAPI, OpenID4VPResponseMode } from "wallet-common";
import { OpenID4VPRelyingPartyState } from "../../types/OpenID4VPRelyingPartyState";
import { useOpenID4VPRelyingPartyStateRepository } from "../OpenID4VPRelyingPartyStateRepository";
import { useHttpProxy } from "../HttpProxy/HttpProxy";
import { useCallback, useContext, useMemo } from "react";
import SessionContext from "@/context/SessionContext";
import CredentialsContext from "@/context/CredentialsContext";
import { useTranslation } from "react-i18next";
import { ParsedTransactionData, parseTransactionDataWithUI } from "./TransactionData/parseTransactionData";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { getLeastUsedCredentialInstance } from "../CredentialBatchHelper";
import { WalletStateUtils } from "@/services/WalletStateUtils";
import { TransactionDataResponse } from "wallet-common";
import { createVerifierTrustEvaluator, createDIDResolver } from "../TrustEvaluator";
import { BACKEND_URL } from "@/config";
import { getTenantFromUrlPath } from "@/lib/tenant";
import { logger, jsonToLog } from '@/logger';

export function useOpenID4VP({
	showTransactionDataConsentPopup,
}: {
	showTransactionDataConsentPopup: (options: Record<string, unknown>) => Promise<boolean>,
}): IOpenID4VP {

	const openID4VPRelyingPartyStateRepository = useOpenID4VPRelyingPartyStateRepository();
	const httpProxy = useHttpProxy();
	const { parseCredential } = useContext(CredentialsContext);
	const { keystore, api } = useContext(SessionContext);
	const { t } = useTranslation();

	const openID4VPServer = useMemo(() => {
		const lastUsedNonceStore = {
			get: () => sessionStorage.getItem('last_used_nonce'),
			set: (nonce: string) => sessionStorage.setItem('last_used_nonce', nonce),
		};
		const rpStateStore = {
			store: async (stateObject: any): Promise<void> => {
				await openID4VPRelyingPartyStateRepository.store(new OpenID4VPRelyingPartyState(
					stateObject.nonce,
					stateObject.response_uri,
					stateObject.client_id,
					stateObject.state,
					stateObject.client_metadata,
					stateObject.response_mode as OpenID4VPResponseMode,
					stateObject.transaction_data,
					stateObject.dcql_query
				));
			},
			retrieve: async () => {
				const stored = await openID4VPRelyingPartyStateRepository.retrieve();
				return {
					nonce: stored.nonce,
					response_uri: stored.response_uri,
					client_id: stored.client_id,
					state: stored.state,
					client_metadata: stored.client_metadata,
					response_mode: stored.response_mode as OpenID4VPResponseMode,
					transaction_data: stored.transaction_data,
					dcql_query: stored.dcql_query,
				};
			},
		};
		const selectCredentialForBatch = async (batchId: number, vcEntityList: ExtendedVcEntity[]): Promise<OpenID4VPServerCredential | null> => {
			const walletState = keystore.getCalculatedWalletState();
			if (!walletState) {
				throw new Error("Empty wallet state");
			}
			return getLeastUsedCredentialInstance(batchId, vcEntityList, walletState);
		};

		// Create trust evaluator and DID resolver for verifier authentication
		// Use URL tenant (more robust than sessionStorage) per smncd's recommendation
		const trustEvaluatorConfig = {
			httpClient: httpProxy,
			backendUrl: BACKEND_URL,
			getAuthToken: () => api.getAppToken() ?? '',
			tenantId: getTenantFromUrlPath() ?? 'default',
		};
		const evaluateTrust = createVerifierTrustEvaluator(trustEvaluatorConfig);
		const resolveDid = createDIDResolver(trustEvaluatorConfig);

		return new OpenID4VPServerAPI<OpenID4VPServerCredential, ParsedTransactionData>({
			httpClient: { get: httpProxy.get },
			rpStateStore,
			parseCredential,
			selectCredentialForBatch,
			keystore,
			strings: {
				purposeNotSpecified: t('selectCredentialPopup.purposeNotSpecified'),
				allClaimsRequested: t('selectCredentialPopup.allClaimsRequested'),
			},
			lastUsedNonceStore,
			parseTransactionData: parseTransactionDataWithUI,
			transactionDataResponseGenerator: TransactionDataResponse,
			evaluateTrust,
			resolveDid,
		});
	}, [
		httpProxy,
		openID4VPRelyingPartyStateRepository,
		parseCredential,
		keystore,
		t,
		api,
	]);

	const handleAuthorizationRequest = useCallback(async (
		url: string,
		vcEntityList: ExtendedVcEntity[],
	): Promise<
		{
			conformantCredentialsMap: Map<string, any>,
			verifierDomainName: string,
			verifierPurpose: string,
			parsedTransactionData: ParsedTransactionData[] | null,
		}
		| { error: HandleAuthorizationRequestErrorType }
	> => {
		const result = await openID4VPServer.handleAuthorizationRequest(url, vcEntityList);
		if ("error" in result) {
			return { error: result.error as HandleAuthorizationRequestErrorType };
		}
		return result;
	}, [openID4VPServer]);

	const sendAuthorizationResponse = useCallback(async (selectionMap, vcEntityList) => {
		const response = await openID4VPServer.createAuthorizationResponse(selectionMap, vcEntityList);
		if (!response || !(response as any).formData) {
			throw new Error('Invalid response from OpenID4VP server');
		}
		const { formData, generatedVPs, filteredVCEntities, response_uri, client_id } = response as {
			formData: URLSearchParams;
			generatedVPs: string[];
			filteredVCEntities: ExtendedVcEntity[];
			response_uri: string;
			client_id: string;
		};

		const transactionId = WalletStateUtils.getRandomUint32();
		const [, newPrivateData, keystoreCommit] = await keystore.addPresentations(generatedVPs.map((vpData, index) => {
			logger.debug("Presentation: ")

			return {
				transactionId: transactionId,
				data: vpData,
				usedCredentialIds: [filteredVCEntities[index].credentialId],
				audience: client_id,
			}
		}));
		await api.updatePrivateData(newPrivateData);
		await keystoreCommit();

		const bodyString = formData.toString();
		logger.debug('bodyString: ', bodyString)
		try {
			const res = await httpProxy.post(response_uri, formData.toString(), {
				'Content-Type': 'application/x-www-form-urlencoded'
			});
			const responseData = res.data as { presentation_during_issuance_session?: string, redirect_uri?: string };
			logger.debug("Direct post response = ", jsonToLog(res.data));
			if (res.status >= 400) {
				throw new Error(`Direct post to verifier failed with status ${res.status}`);
			}
			if (responseData.presentation_during_issuance_session) {
				return { presentation_during_issuance_session: responseData.presentation_during_issuance_session };
			}
			if (responseData.redirect_uri) {
				return { url: responseData.redirect_uri };
			}
		} catch (err) {
			logger.error(err);
			throw err;
		}
	}, [
		httpProxy,
		api,
		keystore,
		openID4VPServer,
	]);

	return useMemo(() => {
		return {
			handleAuthorizationRequest,
			sendAuthorizationResponse,
		}
	}, [
		handleAuthorizationRequest,
		sendAuthorizationResponse,
	]);
}
