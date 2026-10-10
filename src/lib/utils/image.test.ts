import { describe, it, expect } from 'vitest';
import { detectImageMimeFromBytes, ensureStringIsImageDataUri } from './image';
import { fromBase64Url } from './binary';

const SAMPLES = {
	png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
	jpeg: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
	gif: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	webp: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
} as const;

const SAMPLES_URL = {
	png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk-P-_HgAFhAJ_wlseKgAAAABJRU5ErkJggg',
	jpeg: '_9j_4AAQSkZJRgABAQEAYABgAAD_2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL_wAALCAABAAEBAREA_8QAFAABAAAAAAAAAAAAAAAAAAAACP_EABQQAQAAAAAAAAAAAAAAAAAAAAD_2gAIAQEAAD8AN__Z',
	gif: 'R0lGODlhAQABAIAAAAAAAP___yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	webp: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA',
} as const;

describe('detectImageMimeFromBytes', () => {
	it('detects png', () => {
		expect(detectImageMimeFromBytes(fromBase64Url(SAMPLES.png))).toBe('image/png');
	});

	it('detects jpeg', () => {
		expect(detectImageMimeFromBytes(fromBase64Url(SAMPLES.jpeg))).toBe('image/jpeg');
	});

	it('detects jpg (same signature as jpeg)', () => {
		expect(detectImageMimeFromBytes(fromBase64Url(SAMPLES.jpeg))).toBe('image/jpeg');
	});

	it('detects gif', () => {
		expect(detectImageMimeFromBytes(fromBase64Url(SAMPLES.gif))).toBe('image/gif');
	});

	it('detects webp', () => {
		expect(detectImageMimeFromBytes(fromBase64Url(SAMPLES.webp))).toBe('image/webp');
	});

	it('returns null for an unknown signature', () => {
		expect(detectImageMimeFromBytes(fromBase64Url('aGVsbG8gd29ybGQ='))).toBeNull();
	});
});

describe('ensureStringIsImageDataUri', () => {
	describe('bare base64 (mime inferred from signature)', () => {
		it.each([
			['png', SAMPLES.png, 'image/png'],
			['jpeg', SAMPLES.jpeg, 'image/jpeg'],
			['jpg', SAMPLES.jpeg, 'image/jpeg'],
			['gif', SAMPLES.gif, 'image/gif'],
			['webp', SAMPLES.webp, 'image/webp'],
		])('wraps a %s into a data URI', (_label, b64, mime) => {
			expect(ensureStringIsImageDataUri(b64)).toBe(
				`data:${mime};base64,${b64}`,
			);
		});
	});

	describe('full data URI (returned unchanged)', () => {
		it.each([
			['png', SAMPLES.png, 'image/png'],
			['jpeg', SAMPLES.jpeg, 'image/jpeg'],
			['gif', SAMPLES.gif, 'image/gif'],
			['webp', SAMPLES.webp, 'image/webp'],
		])('accepts a %s data URI', (_label, b64, mime) => {
			const uri = `data:${mime};base64,${b64}`;
			expect(ensureStringIsImageDataUri(uri)).toBe(uri);
		});
	});

	describe('mime prefix without "data:"', () => {
		it.each([
			['png', SAMPLES.png, 'image/png'],
			['jpeg', SAMPLES.jpeg, 'image/jpeg'],
			['gif', SAMPLES.gif, 'image/gif'],
			['webp', SAMPLES.webp, 'image/webp'],
		])('prepends "data:" to a %s', (_label, b64, mime) => {
			const input = `${mime};base64,${b64}`;
			expect(ensureStringIsImageDataUri(input)).toBe(`data:${input}`);
		});
	});

	describe('invalid input', () => {
		it('returns null for a non-image mime type', () => {
			expect(
				ensureStringIsImageDataUri('data:text/plain;base64,aGVsbG8='),
			).toBeNull();
		});

		it('returns null for base64 with an unknown signature', () => {
			expect(ensureStringIsImageDataUri('aGVsbG8gd29ybGQ=')).toBeNull();
		});

		it('returns null for a non-base64 string', () => {
			expect(ensureStringIsImageDataUri('not an image!!')).toBeNull();
		});

		it('returns null for an empty string', () => {
			expect(ensureStringIsImageDataUri('')).toBeNull();
		});
	});

	describe('bare base64url (normalised to standard base64)', () => {
		it.each([
			['png', SAMPLES_URL.png, SAMPLES.png, 'image/png'],
			['jpeg', SAMPLES_URL.jpeg, SAMPLES.jpeg, 'image/jpeg'],
			['jpg', SAMPLES_URL.jpeg, SAMPLES.jpeg, 'image/jpeg'],
			['gif', SAMPLES_URL.gif, SAMPLES.gif, 'image/gif'],
			['webp', SAMPLES_URL.webp, SAMPLES.webp, 'image/webp'],
		])('wraps a base64url %s into a standard data URI', (_label, urlB64, stdB64, mime) => {
			expect(ensureStringIsImageDataUri(urlB64)).toBe(`data:${mime};base64,${stdB64}`);
		});
	});
});
