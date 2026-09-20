import type { TFunction } from 'i18next';
import { OIDFlowError } from '../errors';

type FlowErrorFallback = 'vpFlowError' | 'vciFlowError';

/**
 * Credential types an error's details name as requested, if any.
 *
 * The engine sends these on `NO_MATCHING_CREDENTIAL` (`details.requested_types`)
 * so the wallet can say which credential the user is missing rather than only
 * that something did not match.
 */
function requestedTypes(details: Record<string, unknown> | undefined): string[] {
	const types = details?.requested_types;
	if (!Array.isArray(types)) {
		return [];
	}
	return types.filter((type): type is string => typeof type === 'string' && type.length > 0);
}

/**
 * Resolve user-facing copy for an OpenID flow error.
 *
 * Known `OIDFlowError` codes map to `openIdCallback.errorCodes.<CODE>`.
 * Unknown codes and non-OIDFlow errors use the generic VCI or VP fallback.
 *
 * A code whose details name the credential types involved uses the
 * `descriptionWithTypes` variant of its copy when the locale defines one.
 */
export function translateOIDFlowError(
	t: TFunction,
	err: unknown,
	fallback: FlowErrorFallback,
): { title: string; description: string } {
	const fallbackTitle = t(`openIdCallback.${fallback}.title`);
	const fallbackDescription = t(`openIdCallback.${fallback}.description`);

	if (!(err instanceof OIDFlowError) || !err.code) {
		return { title: fallbackTitle, description: fallbackDescription };
	}

	const code = err.code.toUpperCase();
	const title = t(`openIdCallback.errorCodes.${code}.title`, { defaultValue: '' });
	const description = t(`openIdCallback.errorCodes.${code}.description`, { defaultValue: '' });

	const types = requestedTypes(err.details);
	const descriptionWithTypes = types.length > 0
		? t(`openIdCallback.errorCodes.${code}.descriptionWithTypes`, {
			defaultValue: '',
			types: types.join(', '),
		})
		: '';

	return {
		title: title || fallbackTitle,
		description: descriptionWithTypes || description || fallbackDescription,
	};
}
