import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WscdPlugin } from '../resources';
import type { AuthFactor, WscdEligibilityRequirements } from '../types';
import { WscdManagerInPageHost } from './WscdManagerInPageHost';

// Controls the RP id the host compares webauthn factors against.
vi.mock('@/config', () => ({
	WEBAUTHN_RPID: 'wallet.example.com',
	LOG_LEVEL: 'debug',
}));

const RPID = 'wallet.example.com';

function requirements(
	overrides: Partial<WscdEligibilityRequirements> = {},
): WscdEligibilityRequirements {
	return {
		plugin: WscdPlugin.SOFTKEY,
		factors: [{ kind: 'none' }],
		...overrides,
	};
}

// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
describe('WscdManagerInPageHost', () => {
	let host: WscdManagerInPageHost;

	beforeEach(() => {
		host = new WscdManagerInPageHost();
	});

	describe('isAvailable', () => {
		it('is always available', async () => {
			await expect(host.isAvailable()).resolves.toBe(true);
		});
	});

	describe('isEligible', () => {
		it('supports every plugin', async () => {
			for (const plugin of Object.values(WscdPlugin)) {
				// biome-ignore lint/performance/noAwaitInLoops: baseline: pre-existing debt. should be fixed
				await expect(host.isEligible(requirements({ plugin }))).resolves.toBe(true);
			}
		});

		it('satisfies the none and opaque-pin factors', async () => {
			await expect(
				host.isEligible(requirements({ factors: [{ kind: 'none' }, { kind: 'opaque-pin' }] })),
			).resolves.toBe(true);
		});

		it('satisfies a webauthn factor bound to its own RP id', async () => {
			await expect(
				host.isEligible(requirements({ factors: [{ kind: 'webauthn', rpId: RPID }] })),
			).resolves.toBe(true);
		});

		it('rejects a webauthn factor bound to a different RP id', async () => {
			await expect(
				host.isEligible(
					requirements({
						factors: [{ kind: 'webauthn', rpId: 'evil.example.com' }],
					}),
				),
			).resolves.toBe(false);
		});

		it('rejects when any single factor is unsatisfiable', async () => {
			const factors: AuthFactor[] = [
				{ kind: 'none' },
				{ kind: 'webauthn', rpId: 'evil.example.com' },
			];
			await expect(host.isEligible(requirements({ factors }))).resolves.toBe(false);
		});

		it('is eligible for a fully-specified valid request', async () => {
			await expect(
				host.isEligible({
					plugin: WscdPlugin.FIDO2,
					factors: [{ kind: 'webauthn', rpId: RPID }, { kind: 'opaque-pin' }],
				}),
			).resolves.toBe(true);
		});
	});
});
