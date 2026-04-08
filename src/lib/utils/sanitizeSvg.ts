/**
 * SVG Data URL Sanitization
 *
 * Sanitizes SVG data URIs to prevent XSS attacks.
 * SVG images can contain embedded JavaScript that executes when rendered,
 * so we use DOMPurify to remove dangerous elements and attributes.
 *
 * @see https://github.com/sirosfoundation/wallet-frontend/issues/42
 */

import DOMPurify from 'dompurify';
import { logger } from '@/logger';

/**
 * DOMPurify configuration for SVG sanitization
 *
 * - USE_PROFILES.svg: Allow only SVG-safe elements
 * - USE_PROFILES.svgFilters: Allow SVG filter elements
 * - FORBID_TAGS: Explicitly forbid dangerous elements
 * - FORBID_ATTR: Forbid event handler attributes
 */
const DOMPURIFY_CONFIG: DOMPurify.Config = {
	USE_PROFILES: { svg: true, svgFilters: true },
	FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'embed', 'object'],
	FORBID_ATTR: [
		'onload',
		'onerror',
		'onclick',
		'onmouseover',
		'onmouseout',
		'onmouseenter',
		'onmouseleave',
		'onfocus',
		'onblur',
		'onkeydown',
		'onkeyup',
		'onkeypress',
	],
};

/**
 * Decode SVG content from a data URI
 *
 * Supports both base64-encoded and URL-encoded SVG data URIs.
 */
function decodeSvgDataUri(dataUri: string): string | null {
	// Base64 encoded: data:image/svg+xml;base64,PHN2Zy...
	const base64Match = dataUri.match(/^data:image\/svg\+xml;base64,(.+)$/);
	if (base64Match) {
		try {
			return atob(base64Match[1]);
		} catch (e) {
			logger.warn('Failed to decode base64 SVG:', e);
			return null;
		}
	}

	// URL encoded: data:image/svg+xml,%3Csvg...
	// Also handles: data:image/svg+xml;charset=utf-8,%3Csvg...
	const urlEncodedMatch = dataUri.match(/^data:image\/svg\+xml(?:;charset=[^,]+)?,(.+)$/);
	if (urlEncodedMatch) {
		try {
			return decodeURIComponent(urlEncodedMatch[1]);
		} catch (e) {
			logger.warn('Failed to decode URL-encoded SVG:', e);
			return null;
		}
	}

	logger.warn('Unknown SVG data URI format');
	return null;
}

/**
 * Encode sanitized SVG content back to a data URI
 *
 * Uses URL encoding (percent-encoding) which is more readable in devtools
 * and avoids potential issues with base64 padding.
 */
function encodeSvgDataUri(svgContent: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
}

/**
 * Sanitize an SVG data URI to remove potentially dangerous content
 *
 * @param dataUri - The SVG data URI to sanitize (data:image/svg+xml,...)
 * @returns Sanitized SVG data URI, or null if sanitization fails
 *
 * @example
 * const safe = sanitizeSvgDataUri('data:image/svg+xml,<svg><script>alert(1)</script></svg>');
 * // Returns: 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E' (script removed)
 */
export function sanitizeSvgDataUri(dataUri: string): string | null {
	// Only process SVG data URIs
	if (!dataUri.startsWith('data:image/svg+xml')) {
		logger.debug('sanitizeSvgDataUri: Not an SVG data URI, skipping');
		return dataUri;
	}

	// Decode the SVG content
	const svgContent = decodeSvgDataUri(dataUri);
	if (!svgContent) {
		return null;
	}

	// Sanitize the SVG content
	const sanitized = DOMPurify.sanitize(svgContent, DOMPURIFY_CONFIG);

	// Check if DOMPurify removed content (indicates potential attack)
	if (sanitized.length < svgContent.length * 0.5) {
		logger.warn('SVG sanitization removed significant content, possible attack:', {
			originalLength: svgContent.length,
			sanitizedLength: sanitized.length,
		});
	}

	// Re-encode as data URI
	return encodeSvgDataUri(sanitized);
}

/**
 * Sanitize raw SVG content (not a data URI)
 *
 * @param svgContent - Raw SVG XML content
 * @returns Sanitized SVG content
 */
export function sanitizeSvgContent(svgContent: string): string {
	return DOMPurify.sanitize(svgContent, DOMPURIFY_CONFIG);
}

/**
 * Check if a data URI is an SVG
 */
export function isSvgDataUri(dataUri: string): boolean {
	return dataUri.startsWith('data:image/svg+xml');
}
