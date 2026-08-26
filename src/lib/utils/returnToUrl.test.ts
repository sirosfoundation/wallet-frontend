/* eslint-disable no-script-url -- intentional dangerous-scheme payloads for security tests */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	setReturnToUrl,
	getReturnToUrl,
	hasReturnToUrl,
} from './returnToUrl';

/**
 * Simulate base path.
 */
let mockBasePath = '/';

vi.mock('@/config', () => ({
	get BASE_PATH() {
		return mockBasePath;
	},
}));

function roundTrip(raw: string): string | null {
	setReturnToUrl(raw);
	return getReturnToUrl();
}

function isAccepted(raw: string): boolean {
	setReturnToUrl(raw);
	return hasReturnToUrl();
}

const credentialOffer = encodeURIComponent(JSON.stringify({
	credential_issuer: 'https://issuer.example.com',
	credential_configuration_ids: ['eu.europa.ec.eudi.pid_vc_sd_jwt'],
	grants: {
		'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
			'pre-authorized_code': 'adhjhdjajkdkhjhdj',
		},
	},
}));

const credentialOfferUri = encodeURIComponent('https://issuer.example.com/offer/123');

const jwt = [
	'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9',
	'eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlLmNvbSJ9',
	'MEUCIQDx1Hn0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ab',
].join('.');

const presentationSubmission = encodeURIComponent(JSON.stringify({
	id: 'submission-1',
	definition_id: 'pid-request',
	descriptor_map: [{ id: 'pid', format: 'vc+sd-jwt', path: '$' }],
}));

describe('returnToUrl', () => {
	beforeEach(() => {
		mockBasePath = '/';
		sessionStorage.clear();
	});

	it.each([
		'/',
		'/settings',
		'/history?foo=bar',
		'/history#section',
		'/path-with-dashes_and.dots',
		`/cb?credential_offer=${credentialOffer}`,
		`/cb?credential_offer_uri=${credentialOfferUri}`,
		'/cb?credential_offer_uri=https://issuer.example.com/offer/123',
		'/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj',
		`/cb?response=${jwt}`,
		`/cb?vp_token=${jwt}&presentation_submission=${presentationSubmission}`,
	])('accepts %j under every tenant', (path) => {
		mockBasePath = '/';
		expect(roundTrip(path)).toBe(path);

		mockBasePath = '/id/acme/';
		expect(roundTrip(`/id/acme${path}`)).toBe(`/id/acme${path}`);
	});

	it.each([
		'',
		// Protocol-relative open redirect.
		'//evil.com',
		// Backslash normalises to "/" ("/\evil.com" -> "//evil.com").
		'/\\evil.com',
		'\\\\evil.com',
		// Control characters / whitespace used to smuggle a host or scheme.
		'/\t/evil.com',
		' /settings',
		'\u0000//evil.com',
		// Absolute URL / dangerous scheme (not "/"-rooted).
		'https://evil.com',
		'javascript:alert(1)',
		// Query-only value with an empty path.
		'?next=/settings',
	])('rejects sneaky payload %j under every tenant', (raw) => {
		mockBasePath = '/';
		expect(roundTrip(raw)).toBeNull();

		mockBasePath = '/id/acme/';
		expect(roundTrip(raw)).toBeNull();
	});

	describe('default tenant only', () => {
		beforeEach(() => {
			mockBasePath = '/';
		});

		// A custom tenant's namespace is off-limits from the default tenant.
		it.each([
			'/id/acme/settings',
			'/id/../id/evil/settings',
		])('rejects cross-tenant path %j', (raw) => {
			expect(roundTrip(raw)).toBeNull();
		});
	});

	describe('custom tenant only', () => {
		beforeEach(() => {
			mockBasePath = '/id/acme/';
		});

		it.each([
			// Root and paths outside the tenant namespace.
			'/',
			'/settings',
			// A different tenant.
			'/id/other/settings',
			// Prefix-boundary trick (no trailing slash).
			'/id/acmeevil',
			// Traversal escaping the tenant, plain and percent-encoded.
			'/id/acme/../other/settings',
			'/id/acme/..%2Fother/settings',
		])('rejects sneaky payload "%j"', (raw) => {
			expect(roundTrip(raw)).toBeNull();
		});
	});

	describe('hasReturnToUrl', () => {
		it('reports true for a valid stored path', () => {
			expect(isAccepted('/settings')).toBe(true);
		});

		it('reports false for a rejected payload', () => {
			expect(isAccepted('//evil.com')).toBe(false);
		});

		it('reports false when nothing is stored', () => {
			sessionStorage.clear();
			expect(hasReturnToUrl()).toBe(false);
		});

		it('does not consume the value when only checking', () => {
			setReturnToUrl('/settings');
			expect(hasReturnToUrl()).toBe(true);
			expect(getReturnToUrl()).toBe('/settings');
		});
	});

	describe('getReturnToUrl consumes the stored value', () => {
		it('removes the value after a successful read', () => {
			setReturnToUrl('/settings');
			expect(getReturnToUrl()).toBe('/settings');
			expect(getReturnToUrl()).toBeNull();
		});
	});
});
