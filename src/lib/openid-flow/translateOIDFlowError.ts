import type { TFunction } from 'i18next';
import { OIDFlowError } from './errors';

type FlowErrorFallback = 'vpFlowError' | 'vciFlowError';

/**
 * Resolve user-facing copy for an OpenID flow error.
 *
 * Known `OIDFlowError` codes map to `openIdCallback.errorCodes.<CODE>`.
 * Unknown codes and non-OIDFlow errors use the generic VCI or VP fallback.
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

	return {
		title: title || fallbackTitle,
		description: description || fallbackDescription,
	};
}
