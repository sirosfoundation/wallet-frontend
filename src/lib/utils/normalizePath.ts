/**
 * Normalize a path string or array into an array of segments.
 */
export function normalizePath(path: string | string[]): string[] {
	if (Array.isArray(path)) return path;

	if (typeof path === 'string' && path.startsWith('$.')) {
		return path.slice(2).split('.');
	}

	return [path];
};
