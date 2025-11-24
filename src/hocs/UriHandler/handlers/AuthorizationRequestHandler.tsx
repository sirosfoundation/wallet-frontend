import React, { useEffect } from "react";
import { OauthError } from "@wwwallet/client-core";
import { jsonToLog, logger } from "@/logger";
import { ProtocolData, ProtocolStep } from "../resources";

import { useTranslation } from "react-i18next";
import useClientCore from "@/hooks/useClientCore";
import useErrorDialog from "@/hooks/useErrorDialog";

export type AuthorizationRequestHandlerParams = {
	goToStep: (step: ProtocolStep, data: ProtocolData) => void;
	data: any
}

export const AuthorizationRequestHandler = ({ goToStep, data }: AuthorizationRequestHandlerParams) => {

	const {
		issuer,
		issuer_state
	} = data
	const core = useClientCore();
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();

	useEffect(() => {
		core.authorization({
			issuer: issuer,
			issuer_state: issuer_state ?? 'issuer_state',
		}).then(({ nextStep, data }) => {
			return goToStep(nextStep, data)
		}).catch((err) => {
			if (err instanceof OauthError) {
				logger.error(t(`errors.${err.error}`), jsonToLog(err));
				return displayError({
					title: t(`errors.${err.error}`),
					emphasis: t(`errors.${err.data.protocol}.${err.data.currentStep}.description.${err.data.nextStep}`),
					description: t(`errors.${err.data.protocol}.${err.data.currentStep}.${err.error}`),
					err,
				});
			}

			throw err;
		})
	}, [core, goToStep, displayError, t, issuer, issuer_state])

	return (
		<></>
	)
}
