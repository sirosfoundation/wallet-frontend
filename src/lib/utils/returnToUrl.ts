import { BASE_PATH } from '@/config';
import { TENANT_PATH_PREFIX } from '@/lib/tenant';
import { logger } from '@/logger';

const KEY = 'return_to_url';
const TENANT_PREFIX_RE = new RegExp(`^/${TENANT_PATH_PREFIX}(/|$)`);
const DISALLOWED_PATHS: RegExp[] = [/\/login\/?$/, /\/login-state\/?$/, /\/oidc\/cb\/?$/];

/**
 * Stores a URL in sessionStorage to return to after login.
 */
export function setReturnToUrl(url: string): void {
	sessionStorage.setItem(KEY, url);
}

/**
 * Retrieves and consumes the stored return-to URL from sessionStorage.
 */
export function getReturnToUrl(): string | null {
	const value = validateReturnToUrl(sessionStorage.getItem(KEY));
	sessionStorage.removeItem(KEY);
	return value;
}

function validateReturnToUrl(raw: string | null): string | null {
	if (!raw) return null;

	// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
	const queryOrHashIndex = raw.search(/[?#]/);
	const path = queryOrHashIndex === -1 ? raw : raw.slice(0, queryOrHashIndex);

	const hasBackslash = raw.includes('\\'),
		// eslint-disable-next-line no-control-regex -- intentionally matching control chars
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/suspicious/noControlCharactersInRegex: baseline: pre-existing debt. should be fixed
		hasControlOrWhitespace = /[\u0000-\u001F\u007F\s]/.test(raw),
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		hasEncodedTraversal = /%2e|%2f|%5c/i.test(path),
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		hasDotDotTraversal = /(^|\/)\.\.(\/|$)/.test(path),
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		isDifferentOrigin = !/^\/(?!\/)/.test(path),
		isCrossTenant = BASE_PATH === '/' && TENANT_PREFIX_RE.test(path),
		isOutsideBasePath = BASE_PATH !== '/' && !path.startsWith(BASE_PATH),
		isDisallowedPath = DISALLOWED_PATHS.some((re) => re.test(path));

	if (
		hasBackslash ||
		hasControlOrWhitespace ||
		hasEncodedTraversal ||
		hasDotDotTraversal ||
		isDifferentOrigin ||
		isCrossTenant ||
		isOutsideBasePath ||
		isDisallowedPath
	) {
		logger.warn('Rejecting invalid return-to URL');
		logger.debug('Rejected return-to URL details:', {
			path: JSON.stringify(path),
			hasBackslash,
			hasControlOrWhitespace,
			hasEncodedTraversal,
			hasDotDotTraversal,
			isDifferentOrigin,
			isCrossTenant,
			isOutsideBasePath,
			isDisallowedPath,
		});
		return null;
	}

	return raw;
}
