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
	const commaIndex = dataUri.indexOf(',');
	if (commaIndex === -1) {
		logger.warn('Unknown SVG data URI format');
		return null;
	}

	const metadata = dataUri.slice(0, commaIndex);
	const payload = dataUri.slice(commaIndex + 1);

	const metadataParts = metadata.split(';');
	const mediaType = metadataParts[0];

	if (!/^data:image\/svg\+xml$/i.test(mediaType)) {
		logger.warn('Unknown SVG data URI format');
		return null;
	}

	const parameters = metadataParts.slice(1).map((part) => part.trim().toLowerCase());
	const isBase64 = parameters.includes('base64');

	if (isBase64) {
		try {
			return atob(payload);
		} catch (e) {
			logger.warn('Failed to decode base64 SVG:', e);
			return null;
		}
	}

	try {
		return decodeURIComponent(payload);
	} catch (e) {
		logger.warn('Failed to decode URL-encoded SVG:', e);
		return null;
	}
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
	// Only process SVG data URIs (case-insensitive MIME type check)
	if (!/^data:image\/svg\+xml/i.test(dataUri)) {
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
	return encodeSvgDataUri(normalizeSvgImageDimensions(sanitized));
}

/**
 * Sanitize raw SVG content (not a data URI)
 *
 * @param svgContent - Raw SVG XML content
 * @returns Sanitized SVG content
 */
export function sanitizeSvgContent(svgContent: string): string {
	return normalizeSvgImageDimensions(DOMPurify.sanitize(svgContent, DOMPURIFY_CONFIG));
}

/**
 * Check if a data URI is an SVG
 */
export function isSvgDataUri(dataUri: string): boolean {
	return /^data:image\/svg\+xml/i.test(dataUri);
}

/**
 * Default a top-level <image> element's missing width/height to the root
 * <svg>'s own width/height, in place.
 *
 * Per the SVG spec, an <image> element with no height (or width) doesn't
 * render at all in many renderers - a real third-party credential template
 * (EHIC's demo-issuer.wwwallet.org SVG: `<image width="100%"
 * xlink:href="data:image/png;base64,...">`, no height attribute at all) hits
 * this exactly, producing a blank card with no error anywhere. Only fixes
 * elements missing the attribute entirely; an explicit height="0" is left
 * alone since that's a deliberate (if unusual) choice by the template author,
 * not the same "renderer doesn't know what to paint" gap.
 */
export function normalizeSvgImageDimensions(svgContent: string): string {
	if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
		return svgContent;
	}

	try {
		const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
		if (doc.querySelector('parsererror')) {
			return svgContent;
		}

		const root = doc.documentElement;
		const rootWidth = root.getAttribute('width');
		const rootHeight = root.getAttribute('height');
		if (!rootWidth && !rootHeight) {
			return svgContent;
		}

		let changed = false;
		doc.querySelectorAll('image').forEach((image) => {
			if (!image.hasAttribute('width') && rootWidth) {
				image.setAttribute('width', rootWidth);
				changed = true;
			}
			if (!image.hasAttribute('height') && rootHeight) {
				image.setAttribute('height', rootHeight);
				changed = true;
			}
		});

		return changed ? new XMLSerializer().serializeToString(doc) : svgContent;
	} catch (e) {
		logger.warn('Failed to normalize SVG <image> dimensions:', e);
		return svgContent;
	}
}
