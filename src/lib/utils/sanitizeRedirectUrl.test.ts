/* eslint-disable no-script-url -- intentional dangerous-scheme payloads for security tests */
import { describe, it, expect } from "vitest";
import { sanitizeRedirectUrl } from "./sanitizeRedirectUrl";

describe('sanitizeRedirectUrl', () => {
	it('should allow http URLs', () => {
		const url = 'http://example.com/';
		expect(sanitizeRedirectUrl(url)).toBe(url);
	});

	it('should allow https URLs', () => {
		const url = 'https://example.com/';
		expect(sanitizeRedirectUrl(url)).toBe(url);
	});

	it('should allow an http URL object', () => {
		const url = new URL('http://example.com/');
		expect(sanitizeRedirectUrl(url)).toBe('http://example.com/');
	});

	it('should allow an https URL object', () => {
		const url = new URL('https://example.com/');
		expect(sanitizeRedirectUrl(url)).toBe('https://example.com/');
	});

	it('should throw an error for ftp URLs', () => {
		const url = 'ftp://example.com/';
		expect(() => sanitizeRedirectUrl(url)).toThrowError(
			'Prohibited URL scheme "ftp" in redirect URL "ftp://example.com/"'
		);
	});

	it('should throw an error for javascript URLs', () => {
		const url = 'javascript:alert("XSS")';
		expect(() => sanitizeRedirectUrl(url)).toThrowError(
			'Prohibited URL scheme "javascript" in redirect URL "javascript:alert("XSS")"'
		);
	});

	it.each([
		['JAVASCRIPT:alert(1)', 'javascript'],
		['jAvAsCrIpT:alert(document.cookie)', 'javascript'],
		['java\tscript:alert(1)', 'javascript'],
		['java\nscript:alert(1)', 'javascript'],
		['java\rscript:alert(1)', 'javascript'],
		['j\ta\nv\ra\ts\ncript:alert(1)', 'javascript'],
		['\u0000\u0001\u0002   javascript:alert(1)', 'javascript'],
		['\t\n\r javascript:alert(1)', 'javascript'],
		['data:text/html,<script>alert(document.domain)</script>', 'data'],
		['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'data'],
		['vbscript:msgbox(1)', 'vbscript'],
		['file:///etc/passwd', 'file'],
		['blob:https://example.com/550e8400-e29b', 'blob'],
		['DaTa:text/html,x', 'data'],
	])('should block sneaky payload %j (scheme %s)', (payload, scheme) => {
		expect(() => sanitizeRedirectUrl(payload)).toThrowError(
			new RegExp(`Prohibited URL scheme "${scheme}"`)
		);
	});

	it.each([
		'//evil.com',
		'java\u0000script:x',
		'not a url',
	])('throws generic parse error for %j', (payload) => {
		expect(() => sanitizeRedirectUrl(payload)).toThrowError(/Invalid URL/);
	});
});
