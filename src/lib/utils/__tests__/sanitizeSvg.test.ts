/**
 * Tests for SVG sanitization utility
 */

import { describe, it, expect } from 'vitest';
import { sanitizeSvgDataUri, sanitizeSvgContent, isSvgDataUri } from '../sanitizeSvg';

describe('sanitizeSvg', () => {
	describe('isSvgDataUri', () => {
		it('should return true for SVG data URIs', () => {
			expect(isSvgDataUri('data:image/svg+xml,<svg></svg>')).toBe(true);
			expect(isSvgDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true);
			expect(isSvgDataUri('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E')).toBe(true);
		});

		it('should return false for non-SVG data URIs', () => {
			expect(isSvgDataUri('data:image/png;base64,abc')).toBe(false);
			expect(isSvgDataUri('data:text/html,<html></html>')).toBe(false);
			expect(isSvgDataUri('https://example.com/image.svg')).toBe(false);
		});
	});

	describe('sanitizeSvgContent', () => {
		it('should preserve safe SVG content', () => {
			const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>';
			const result = sanitizeSvgContent(safeSvg);
			expect(result).toContain('<svg');
			expect(result).toContain('<rect');
			expect(result).toContain('fill="red"');
		});

		it('should remove script elements', () => {
			const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>';
			const result = sanitizeSvgContent(maliciousSvg);
			expect(result).not.toContain('<script');
			expect(result).not.toContain('alert');
			expect(result).toContain('<svg');
		});

		it('should remove foreignObject elements', () => {
			const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>';
			const result = sanitizeSvgContent(maliciousSvg);
			expect(result).not.toContain('<foreignObject');
			expect(result).not.toContain('<script');
			expect(result).not.toContain('<body');
		});

		it('should remove event handler attributes', () => {
			const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="alert(2)" width="100" height="100"/></svg>';
			const result = sanitizeSvgContent(maliciousSvg);
			expect(result).not.toContain('onload');
			expect(result).not.toContain('onclick');
			expect(result).toContain('<rect');
		});

		it('should remove iframe elements', () => {
			const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="javascript:alert(1)"></iframe></svg>';
			const result = sanitizeSvgContent(maliciousSvg);
			expect(result).not.toContain('<iframe');
		});
	});

	describe('sanitizeSvgDataUri', () => {
		it('should pass through non-SVG data URIs unchanged', () => {
			const pngUri = 'data:image/png;base64,abc123';
			expect(sanitizeSvgDataUri(pngUri)).toBe(pngUri);
		});

		it('should sanitize URL-encoded SVG data URIs', () => {
			const dangerousUri = 'data:image/svg+xml,%3Csvg%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E%3C%2Fsvg%3E';
			const result = sanitizeSvgDataUri(dangerousUri);
			expect(result).not.toBeNull();
			expect(result).not.toContain('script');
			expect(result).toContain('data:image/svg+xml');
		});

		it('should sanitize base64-encoded SVG data URIs', () => {
			// Base64 of: <svg><script>alert(1)</script></svg>
			const dangerousUri = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';
			const result = sanitizeSvgDataUri(dangerousUri);
			expect(result).not.toBeNull();
			expect(result).not.toContain('script');
		});

		it('should preserve safe SVG data URIs', () => {
			const safeUri = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E';
			const result = sanitizeSvgDataUri(safeUri);
			expect(result).not.toBeNull();
			expect(result).toContain('svg');
			expect(result).toContain('rect');
		});

		it('should handle SVG with charset in data URI', () => {
			const uriWithCharset = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E';
			const result = sanitizeSvgDataUri(uriWithCharset);
			expect(result).not.toBeNull();
			expect(result).toContain('data:image/svg+xml');
		});

		it('should return null for malformed base64', () => {
			const malformedUri = 'data:image/svg+xml;base64,!!!invalid!!!';
			const result = sanitizeSvgDataUri(malformedUri);
			expect(result).toBeNull();
		});
	});
});
