import { useState, useRef, useCallback, useContext, isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { DcqlQuery } from 'dcql';
import { type OID4VPVerifierInfo } from '@/lib/openid-flow';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import type {
	ConformantCredentials,
	PresentationResult,
	PresentCredentialSet,
	PresentCredentialsFlowView,
	PresentCredentialsQuery,
	PresentCredentialsRequest,
	PresentCredentialsResult,
	PresentCredentialsVerifier,
} from './types';

export function usePresentCredentialsFlow() {
	const [view, setView] = useState<PresentCredentialsFlowView>({ status: 'loading' });
	const sharingAbort = useRef<AbortController | null>(null);
	const { vcEntityList } = useContext(CredentialsContext);
	const { i18n: { language } } = useTranslation();

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
				language,
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

	const displaySharingScreen = useCallback((): AbortSignal => {
		const controller = new AbortController();
		sharingAbort.current = controller;
		setView({ status: 'sharing', onCancel: () => controller.abort() });
		return controller.signal;
	}, []);

	const displayCompletedScreen = useCallback(async (result: PresentationResult) => {
		setView({ status: 'shared', result });

		return new Promise((resolve) => {
			setTimeout(resolve, 1500);
		});
	}, []);

	const displayFailedScreen = useCallback((error: string, onRetry: () => void) => {
		setView({ status: 'error', error, onRetry });
	}, []);

	const resetScreen = useCallback(() => {
		setView({ status: 'loading' });
	}, []);

	return {
		view,
		displayRequestOverviewScreen,
		displaySharingScreen,
		displayCompletedScreen,
		displayFailedScreen,
		resetScreen,
	};
}

async function resolveCredentialPresentationRequest(
	verifierInfo: OID4VPVerifierInfo,
	dcqlQuery: DcqlQuery.Input,
	conformantCredentials: ConformantCredentials,
	vcEntityList: ExtendedVcEntity[],
	preferredLanguage: string
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
				const { name } = parsedCredential.metadata.credential;
				const claims = parsedCredential.metadata.credential.TypeMetadata?.claims ?? [];

				return {
					batchId: vcEntity.batchId,
					display: {
						name: await name([preferredLanguage]),
						// TODO: expose color and icon from credential metadata
						color: null,
						icon: null,
					},
					fields: (conformant?.requestedFields ?? []).map((f) => ({
						name: resolveClaimLabel(claims, f, preferredLanguage),
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

function resolveClaimLabel(
	claims: Array<{ path: Array<string | number | null>; display?: Array<{ locale: string; label: string }> }>,
	field: { name?: string; path?: string[] },
	preferredLanguage: string,
): string {
	const target = JSON.stringify(field.path ?? []);
	const claim = claims.find((c) => JSON.stringify(c.path.filter((s) => s !== null)) === target);
	const label = claim?.display?.find((d) => d.locale === preferredLanguage)?.label
		?? claim?.display?.[0]?.label;

	return label ?? field.name ?? field.path?.filter(Boolean).join(' › ') ?? 'Unknown';
}
