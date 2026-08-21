import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
 * The per-transport runtime behaviour is covered in
 * `OIDFlowWebSocketTransport.test.ts` and
 * `src/lib/services/OpenID4VP/OpenID4VP.redirect.test.tsx`. What is left to
 * guard here is a *future* transport reintroducing the field, which the type
 * system catches but CI does not: CI runs `vitest run` without `--typecheck`
 * and does not run `yarn typecheck` (blocked on 35 pre-existing errors). So
 * the transport sources are scanned instead, which also covers transport files
 * that do not exist yet.
 */
// Resolved from the repo root rather than import.meta.url, which Vite rewrites
// to an http:// URL in the test environment.
const TRANSPORTS_DIR = resolve(process.cwd(), 'src/lib/openid-flow/transports');

describe('OID4VPFlowResult redirect handling', () => {
	it('has no redirectUri field for any transport to populate', () => {
		const result: OID4VPFlowResult = {
			success: true,
			// @ts-expect-error - re-adding redirectUri reintroduces the #159 redirect race
			redirectUri: 'https://verifier.example.com/callback',
		};

		const wellFormed: OID4VPFlowResult = { success: true };
		expect(wellFormed).not.toHaveProperty('redirectUri');
		expect(Object.keys(result)).toContain('success');
	});

	it('has no transport assigning a redirect onto a flow result', () => {
		const transports = readdirSync(TRANSPORTS_DIR).filter((f) => f.endsWith('.ts'));

		// Sanity check: a bad path would make the scan below vacuously pass.
		expect(transports).toContain('OIDFlowWebSocketTransport.ts');

		const offenders = transports.filter((file) => {
			const source = readFileSync(`${TRANSPORTS_DIR}/${file}`, 'utf8');
			// Assignment onto a result/response object, e.g. `result.redirectUri = ...`.
			// Reads such as OID4VCI's `redirect_uri: params.redirectUri` are fine.
			return /\.redirectUri\s*=[^=]/.test(source);
		});

		expect(offenders).toEqual([]);
	});
});
