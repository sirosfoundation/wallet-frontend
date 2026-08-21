import { describe, expect, it } from 'vitest';
import type { OID4VPFlowResult } from '../types/OID4VPTypes';

/**
 * Transport-independent guard for issue #159.
 *
 * The verifier's `redirect_uri` must never reach the wallet UI: the browser
 * that started the flow owns the redirect back to the RP, and a second
 * navigation races it for the same authorization code.
 *
 * `OID4VPFlowResult` is the shared contract every transport returns
 * (http_proxy, websocket, direct, and any future one such as WMP), so keeping
 * the field off this type is what makes the fix hold for all of them rather
 * than for the transports that happened to exist when it was written.
 *
 * The compile-time half of this guard is enforced by `yarn typecheck`
 * (vitest does not typecheck unless run with --typecheck).
 */
describe('OID4VPFlowResult redirect handling', () => {
	it('has no redirectUri field for any transport to populate', () => {
		const result: OID4VPFlowResult = {
			success: true,
			// @ts-expect-error - re-adding redirectUri reintroduces the #159 redirect race
			redirectUri: 'https://verifier.example.com/callback',
		};

		// Excess-property checking is compile-time only, so also assert that
		// nothing downstream can read a value off a well-formed result.
		const wellFormed: OID4VPFlowResult = { success: true };
		expect(wellFormed).not.toHaveProperty('redirectUri');
		expect(Object.keys(result)).toContain('success');
	});
});
