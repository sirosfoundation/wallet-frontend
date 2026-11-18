import { describe, expect, it } from 'vitest';

import {
	DEFAULT_INTEROP_PROFILE,
	isInteropProfile,
	resolveDidKeyVersion,
} from './interopProfile';

describe('DEFAULT_INTEROP_PROFILE', () => {
	// Adding DIIP support must not change the proof shape every existing SIROS issuer already
	// accepts. A deployment targeting a DIIP ecosystem opts in.
	it('is HAIP', () => {
		expect(DEFAULT_INTEROP_PROFILE).toBe('haip');
	});
});

describe('isInteropProfile', () => {
	it('accepts the two profiles', () => {
		expect(isInteropProfile('haip')).toBe(true);
		expect(isInteropProfile('diip')).toBe(true);
	});

	it('rejects anything else, so a typo falls back to the default', () => {
		for (const value of ['HAIP', 'diip ', '', undefined, null, 1]) {
			expect(isInteropProfile(value)).toBe(false);
		}
	});
});

describe('resolveDidKeyVersion', () => {
	describe('with no issuer metadata to go on', () => {
		it('mints the configured did:key flavour under HAIP', () => {
			expect(resolveDidKeyVersion({
				profile: 'haip', configuredDidKeyVersion: 'jwk_jcs-pub',
			})).toBe('jwk_jcs-pub');
		});

		it('mints did:jwk under DIIP regardless of the configured flavour', () => {
			// DIIP names did:jwk specifically, so the did:key knob has nothing to say.
			expect(resolveDidKeyVersion({
				profile: 'diip', configuredDidKeyVersion: 'p256-pub',
			})).toBe('jwk');
		});

		it('leaves the version unset when HAIP is configured with no flavour', () => {
			// Pre-existing behaviour: the value is required from config, and minting fails
			// loudly rather than picking a Holder identifier the deployment did not choose.
			expect(resolveDidKeyVersion({ profile: 'haip' })).toBeUndefined();
		});
	});

	describe('negotiating from cryptographic_binding_methods_supported', () => {
		// What the Issuer advertises beats the local preference. This is what stops two wallets
		// configured differently from disagreeing against the same issuer, and what means nobody
		// has to know which profile an issuer they just scanned belongs to.
		it('uses did:jwk when that is all the issuer accepts, even under HAIP', () => {
			expect(resolveDidKeyVersion({
				profile: 'haip',
				configuredDidKeyVersion: 'jwk_jcs-pub',
				advertisedBindingMethods: ['did:jwk'],
			})).toBe('jwk');
		});

		it('uses the raw key when that is all the issuer accepts, even under DIIP', () => {
			// Our own issuers advertise exactly this, so a DIIP-configured wallet still
			// interoperates with them without being reconfigured.
			expect(resolveDidKeyVersion({
				profile: 'diip',
				configuredDidKeyVersion: 'jwk_jcs-pub',
				advertisedBindingMethods: ['jwk'],
			})).toBe('jwk_jcs-pub');
		});

		it('lets the profile break the tie when the issuer accepts both', () => {
			// vc publishes ["did:jwk", "jwk"] once configured, and the order it happens to list
			// them in should not be what decides.
			const both = ['did:jwk', 'jwk'];
			expect(resolveDidKeyVersion({
				profile: 'diip', configuredDidKeyVersion: 'jwk_jcs-pub', advertisedBindingMethods: both,
			})).toBe('jwk');
			expect(resolveDidKeyVersion({
				profile: 'haip', configuredDidKeyVersion: 'jwk_jcs-pub', advertisedBindingMethods: both,
			})).toBe('jwk_jcs-pub');
		});

		it('falls back to the profile for methods this wallet cannot produce', () => {
			// Better to send what the profile says and let the issuer reject it than to pick
			// silently from a list of things it did not offer.
			expect(resolveDidKeyVersion({
				profile: 'haip',
				configuredDidKeyVersion: 'jwk_jcs-pub',
				advertisedBindingMethods: ['cose_key', 'did:web'],
			})).toBe('jwk_jcs-pub');
		});

		it('falls back to the profile for an empty list', () => {
			expect(resolveDidKeyVersion({
				profile: 'diip', configuredDidKeyVersion: 'jwk_jcs-pub', advertisedBindingMethods: [],
			})).toBe('jwk');
		});
	});
});
