/**
 * Removes all characters from the input string except for:
 * - Letters (a-z, A-Z)
 * - Numbers (0-9)
 * - Hyphens (-)
 * - Underscores (_)
 *
 * Useful for generating safe HTML id attributes.
 *
 * @param value - The string to sanitize
 * @returns A sanitized string safe for use in HTML IDs
 */
export function sanitizeId(value: string | number): string {
	const str = String(value);
	return str.replace(/[^a-zA-Z0-9-_]/g, "");
}
