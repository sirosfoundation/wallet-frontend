import { useState, useRef, useCallback, useContext, isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { DcqlQuery } from 'dcql';
import { type OID4VPVerifierInfo } from '@/lib/openid-flow';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import type {
	ConformantCredentials,
	PresentationErrorState,
	PresentationResult,
	PresentCredentialSet,
	PresentCredentialsFlowView,
	PresentCredentialsQuery,
	PresentCredentialsRequest,
	PresentCredentialsResult,
	PresentCredentialsVerifier,
} from './types';

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
	const { vcEntityList } = useContext(CredentialsContext);
	const { t, i18n: { language } } = useTranslation();

	const displayRequestOverviewScreen = useCallback(
		async (
			verifierInfo: OID4VPVerifierInfo,
			dcqlQuery: DcqlQuery.Input,
			conformantCredentials: ConformantCredentials
		): Promise<PresentCredentialsResult> => {
			const request = await resolveCredentialPresentationRequest(
				verifierInfo,
				dcqlQuery,
				conformantCredentials,
				vcEntityList,
				[language, 'en'],
			);

			return new Promise((resolve, reject) => {
				setView({
					status: 'request',
					onAccept: (result) => resolve(result),
					onDecline: () => reject(),
					request,
				});
			});
		},
		[vcEntityList, language],
	);

	const displayProcessingScreen = useCallback((messages: string[] = [t('common.loading')]): AbortSignal => {
		const controller = new AbortController();
		sharingAbort.current = controller;
		setView({ status: 'sharing', messages, onCancel: () => controller.abort() });

		return controller.signal;
	}, [t]);

	const displaySendingScreen = useCallback((): void => {
		sharingAbort.current = null;
		setView({ status: 'sharing', messages: [t('presentCredentialsFlow.sharing.sending')], onCancel: undefined, });
	}, [t]);

	const displayCompletedScreen = useCallback(async (result: PresentationResult) => {
		setView({ status: 'shared', result });

		return new Promise((resolve) => {
			setTimeout(resolve, 1500);
		});
	}, []);

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

/**
 * Resolve a credential presentation request into a PresentCredentialsRequest object.
 * This includes shaping the credentials, extracting available claims, and resolving display information.
 */
async function resolveCredentialPresentationRequest(
	verifierInfo: OID4VPVerifierInfo,
	dcqlQuery: DcqlQuery.Input,
	conformantCredentials: ConformantCredentials,
	vcEntityList: ExtendedVcEntity[],
	preferredLanguages: string[]
): Promise<PresentCredentialsRequest> {
	const verifier: PresentCredentialsVerifier = {
		name: verifierInfo.name,
		domain: verifierInfo.domain,
		logo: verifierInfo.logo,
	};

	const queries: PresentCredentialsQuery[] = await Promise.all(dcqlQuery.credentials.map(async (query) => {
		const id = query.id;

		const conformant = conformantCredentials.get(id);

		const matches = await Promise.all(vcEntityList
			.filter((vcEntity) => {
				const conformant = conformantCredentials.get(id);
				if (!conformant) return false;

				return conformant.credentials.includes(vcEntity.batchId);
			})
			.map(async (vcEntity) => {
				const { parsedCredential } = vcEntity;
				const { name, rendering } = parsedCredential.metadata.credential;
				const claims = parsedCredential.metadata.credential.TypeMetadata?.claims ?? [];

				const { backgroundColor, textColor, logo } = await rendering(preferredLanguages);
				return {
					batchId: vcEntity.batchId,
					display: {
						name: await name(preferredLanguages),
						backgroundColor,
						textColor,
						logo,
					},
					fields: (conformant?.requestedFields ?? []).map((f) => ({
						name: resolveClaimLabel(claims, f, preferredLanguages),
						value: getValueByPath(f.path ?? [], parsedCredential.signedClaims),
					})),
				};
			}));

		return {
			id,
			matches,
		};
	}));

	const sets: PresentCredentialSet[] = dcqlQuery.credential_sets?.length
		? dcqlQuery.credential_sets.map((set) => ({
				purpose: set.purpose != null ? String(set.purpose) : undefined,
				required: set.required,
				options: set.options,
			}))
		: [{
				required: true,
				options: [dcqlQuery.credentials.map((c) => c.id)],
			}];

	return {
		verifier,
		queries,
		sets,
	};
}

/**
 * Get a value from an object by a path array, where null segments indicate
 * "any key".
 *
 * @example
 * ```ts
 * getValueByPath(['a', null, 'c'], { a: { x: { c: 1 }, y: { c: 2 } } });
 * // [1, 2]
 * ```
 */
function getValueByPath(path: string[], obj: Record<string, unknown>): any {
	if (!Array.isArray(path) || path.length === 0) return undefined;

	const traverse = (segments: string[], current: unknown): unknown => {
		if (segments.length === 0) return current;
		const [head, ...tail] = segments;

		if (head === null && typeof current === 'object' && current !== null) {
			return Object.values(current).map(item => traverse(tail, item)).filter(v => v !== undefined);
		}

		if (current && typeof current === 'object' && head in current) {
			return traverse(tail, current[head]);
		}
		return undefined;
	};

	const result = traverse(path, obj);

	if (
		typeof result === 'object' &&
		result !== null &&
		!isValidElement(result) &&
		Object.keys(result).length === 0
	) {
		return undefined;
	}

	return result;
}

/**
 * Resolve a claim label from the claims metadata, falling back to
 * the field name or path if no label is found.
 */
function resolveClaimLabel(
	claims: Array<{ path: Array<string | number | null>; display?: Array<{ locale: string; label: string }> }>,
	field: { name?: string; path?: string[] },
	preferredLanguages: string[],
): string {
	const target = JSON.stringify(field.path ?? []);
	const claim = claims.find((c) => JSON.stringify(c.path.filter((s) => s !== null)) === target);
	const label = claim?.display?.find((d) => preferredLanguages.includes(d.locale))?.label
		?? claim?.display?.[0]?.label;

	return label ?? field.name ?? field.path?.filter(Boolean).join(' › ') ?? 'Unknown';
}
