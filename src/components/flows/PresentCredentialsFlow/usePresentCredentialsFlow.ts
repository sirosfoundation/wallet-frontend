import { useState, useRef, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { DcqlQuery } from 'dcql';
import { type OID4VPVerifierInfo } from '@/lib/openid-flow';
import CredentialsContext from '@/context/CredentialsContext';
import type {
	ConformantCredentials,
	PresentationErrorState,
	PresentationResult,
	PresentCredentialsFlowView,
	PresentCredentialsResult,
} from './types';
import { resolveCredentialPresentationRequest } from './utils';
import { OIDFlowError } from '@/lib/openid-flow/errors';

/**
 * Hook for managing the Present Credentials Flow.
 *
 * Provides state and functions for displaying the various screens of the flow.
 *
 * Used in tandem with the {@link PresentCredentialsFlow} component
 * to render the flow.
 *
 * See {@link PresentCredentialsFlowView} for details on the view state.
 * See {@link PresentCredentialsRequest} for details on the request data.
 */
export function usePresentCredentialsFlow() {
	const [view, setView] = useState<PresentCredentialsFlowView>({ status: 'loading' });
	const sharingAbort = useRef<AbortController | null>(null);
	const { vcEntityList, fetchVcData } = useContext(CredentialsContext);
	const {
		t,
		i18n: { language },
	} = useTranslation();

	const displayRequestOverviewScreen = useCallback(
		async (
			verifierInfo: OID4VPVerifierInfo,
			dcqlQuery: DcqlQuery.Input,
			conformantCredentials: ConformantCredentials,
		): Promise<PresentCredentialsResult> => {
			// vcEntityList is null until the credential engine finishes its
			// first load. A verifier-initiated presentation lands on the
			// callback route and starts resolving immediately, which can beat
			// that load - so fetch on demand rather than handing null to the
			// resolver, which would crash on it.
			//
			// A null from fetchVcData is a load FAILURE (no credential engine
			// or wallet state), not an empty wallet - an empty wallet is []
			// and is allowed through. Defaulting the failure to [] would show
			// the user an empty selection as though they simply held nothing
			// matching, hiding the real cause, so surface it instead.
			const credentials = vcEntityList ?? (await fetchVcData());
			if (!credentials) {
				throw new OIDFlowError({
					code: 'CREDENTIALS_UNAVAILABLE',
					message: 'Credentials could not be loaded',
				});
			}

			const request = await resolveCredentialPresentationRequest(
				verifierInfo,
				dcqlQuery,
				conformantCredentials,
				credentials,
				[language, 'en'],
			);

			return new Promise((resolve, reject) => {
				setView({
					status: 'request',
					onAccept: (result) => resolve(result),
					onDecline: () =>
						reject(new OIDFlowError({ code: 'USER_CANCELLED', message: 'User cancelled' })),
					request,
				});
			});
		},
		[vcEntityList, fetchVcData, language],
	);

	const displayProcessingScreen = useCallback(
		(messages: string[] = [t('common.loading')]): AbortSignal => {
			const controller = new AbortController();
			sharingAbort.current = controller;
			setView({ status: 'sharing', messages, onCancel: () => controller.abort() });

			return controller.signal;
		},
		[t],
	);

	const displaySendingScreen = useCallback((): void => {
		sharingAbort.current = null;
		setView({
			status: 'sharing',
			messages: [t('presentCredentialsFlow.sharing.sending')],
			onCancel: undefined,
		});
	}, [t]);

	const displayCompletedScreen = useCallback(
		async (result: PresentationResult, onClose?: () => void) => {
			setView({ status: 'shared', result, onClose });

			return new Promise((resolve) => {
				setTimeout(resolve, 1500);
			});
		},
		[],
	);

	const displayErrorScreen = useCallback((state: PresentationErrorState) => {
		setView({ status: 'error', state });
	}, []);

	const resetScreen = useCallback(() => {
		setView({ status: 'loading' });
	}, []);

	return {
		/**
		 * The current view of the Present Credentials Flow.
		 * This can be used to render the appropriate screen for the user.
		 * The view is a discriminated union of the possible states of the flow.
		 * See {@link PresentCredentialsFlowView} for details.
		 */
		view,
		/**
		 * Display the request overview screen, allowing the user to
		 * accept or decline the request.
		 * See {@link displayRequestOverviewScreen} for details.
		 */
		displayRequestOverviewScreen,
		/**
		 * Display the processing screen for cancellable, pre-send work.
		 * See {@link displayProcessingScreen} for details.
		 */
		displayProcessingScreen,
		/**
		 * Display the sharing screen while the response is sent to the verifier.
		 * See {@link displaySendingScreen} for details.
		 */
		displaySendingScreen,
		/**
		 * Display the completed screen after the response has been successfully sent.
		 * See {@link displayCompletedScreen} for details.
		 */
		displayCompletedScreen,
		/**
		 * Display the error screen if something goes wrong.
		 * See {@link displayErrorScreen} for details.
		 */
		displayErrorScreen,
		/**
		 * Reset the flow to the initial loading state.
		 * See {@link resetScreen} for details.
		 */
		resetScreen,
	};
}
