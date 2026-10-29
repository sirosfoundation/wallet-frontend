import type { TFunction } from 'i18next';
import { OIDFlowError } from '../errors';

type FlowErrorFallback = 'vpFlowError' | 'vciFlowError';

/**
 * Credential types the wallet found missing locally (`details.missing_types`), if any.
 */
function missingTypes(details: Record<string, unknown> | undefined): string[] {
	const types = details?.missing_types;
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
 * A code whose details name missing credential types uses the
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

	const types = missingTypes(err.details);
	const descriptionWithTypes = types.length > 0
		? t(`openIdCallback.errorCodes.${code}.descriptionWithTypes`, {
			defaultValue: '',
			count: types.length,
			types: types.join(', '),
		})
		: '';

	return {
		title: title || fallbackTitle,
		description: descriptionWithTypes || description || fallbackDescription,
	};
}
