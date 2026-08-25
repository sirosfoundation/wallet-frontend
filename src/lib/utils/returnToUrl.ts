import { BASE_PATH } from '@/config';

const KEY = 'return_to_url';

/**
 * Stores a URL in sessionStorage to return to after login.
 */
export function setReturnToUrl(url: string): void {
	sessionStorage.setItem(KEY, url);
}

/**
 * Checks if a return-to URL is stored in sessionStorage.
 */
export function hasReturnToUrl(): boolean {
	return validateReturnToUrl(sessionStorage.getItem(KEY)) !== null;
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
	if (
		!raw ||
		(raw === '/' && BASE_PATH !== '/') ||
		(BASE_PATH !== '/' && !raw.startsWith(BASE_PATH)) ||
		!/^\/(?!\/)/.test(raw)
	) return null;

	return raw;
}
