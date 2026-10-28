import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NativeWrapper } from '@/lib/native-wrapper/types';
import {
	WscdHostStrength,
	WscdManagerHosts,
	WscdPlugin,
	type WscdContainer,
} from '../resources';
import type { AuthFactor, WscdEligibilityRequirements } from '../types';
import { ensureEncodedWscdContainer } from '../utils';
import { WscdManagerNativeWrapperHost } from './WscdManagerNativeWrapperHost';

// Controls the RP id the host compares webauthn factors against.
vi.mock('@/config', () => ({
	WEBAUTHN_RPID: 'wallet.example.com',
	LOG_LEVEL: 'debug',
}));

const RPID = 'wallet.example.com';

const container: WscdContainer = {
	keys: [{ kid: 'sw-1234', algorithm: 'ES256', d: 'ZmFrZQ', created_at: 0 }],
	lifecycle: {},
};

function requirements(
	overrides: Partial<WscdEligibilityRequirements> = {},
): WscdEligibilityRequirements {
	return {
		plugin: WscdPlugin.SOFTKEY,
		factors: [{ kind: 'none' }],
		...overrides,
	};
}

describe('WscdManagerNativeWrapperHost', () => {
	let host: WscdManagerNativeWrapperHost;
	let callWscd: Mock;

	beforeEach(() => {
		callWscd = vi.fn();
		window.nativeWrapper = { callWscd } as unknown as NativeWrapper;
		host = new WscdManagerNativeWrapperHost();
	});

	afterEach(() => {
		delete window.nativeWrapper;
		vi.restoreAllMocks();
	});

	describe('identity', () => {
		it('reports its host id and strength', () => {
			expect(host.id).toBe(WscdManagerHosts.NATIVE_WRAPPER);
			expect(host.strength).toBe(WscdHostStrength.NATIVE_WRAPPER);
		});

		it('advertises the softkey, fido2 and r2ps plugins', () => {
			expect(host.supportedPlugins.has(WscdPlugin.SOFTKEY)).toBe(true);
			expect(host.supportedPlugins.has(WscdPlugin.FIDO2)).toBe(true);
			expect(host.supportedPlugins.has(WscdPlugin.R2PS)).toBe(true);
		});
	});

	describe('initialize', () => {
		it('resolves', async () => {
			await expect(host.initialize()).resolves.toBeUndefined();
		});
	});

	describe('isAvailable', () => {
		it('is available when the bridge exposes callWscd', async () => {
			await expect(host.isAvailable()).resolves.toBe(true);
		});

		it('is unavailable when there is no native wrapper', async () => {
			delete window.nativeWrapper;
			await expect(host.isAvailable()).resolves.toBe(false);
		});

		it('is unavailable when callWscd is not a function', async () => {
			window.nativeWrapper = { callWscd: 'nope' } as unknown as NativeWrapper;
			await expect(host.isAvailable()).resolves.toBe(false);
		});
	});

	describe('isEligible', () => {
		it('supports every plugin', async () => {
			for (const plugin of Object.values(WscdPlugin)) {
				await expect(host.isEligible(requirements({ plugin }))).resolves.toBe(
					true,
				);
			}
		});

		it('satisfies the none and opaque-pin factors', async () => {
			await expect(
				host.isEligible(
					requirements({ factors: [{ kind: 'none' }, { kind: 'opaque-pin' }] }),
				),
			).resolves.toBe(true);
		});

		it('satisfies a webauthn factor bound to its own RP id', async () => {
			await expect(
				host.isEligible(
					requirements({ factors: [{ kind: 'webauthn', rpId: RPID }] }),
				),
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
			await expect(host.isEligible(requirements({ factors }))).resolves.toBe(
				false,
			);
		});
	});

	describe('sign', () => {
		it('forwards the kid and data to the bridge and returns the signature', async () => {
			const kid = 'sw-1234';
			const data = new Uint8Array([1, 2, 3]);
			const signature = new Uint8Array([9, 9, 9]);
			callWscd.mockResolvedValue(signature);

			await expect(host.sign(kid, data)).resolves.toBe(signature);
			expect(callWscd).toHaveBeenCalledTimes(1);
			expect(callWscd).toHaveBeenCalledWith('sign', kid, data);
		});

		it('throws when the bridge returns a non-Uint8Array signature', async () => {
			callWscd.mockResolvedValue('not-bytes');
			await expect(host.sign('sw-1234', new Uint8Array())).rejects.toThrow(
				'Invalid signature returned from native wrapper',
			);
		});

		it('propagates a bridge rejection', async () => {
			callWscd.mockRejectedValue(new Error('bridge boom'));
			await expect(host.sign('sw-1234', new Uint8Array())).rejects.toThrow(
				'bridge boom',
			);
		});
	});

	describe('importContainer', () => {
		it('forwards the encoded container to the bridge', async () => {
			callWscd.mockResolvedValue(undefined);

			await expect(host.importContainer(container)).resolves.toBeUndefined();
			expect(callWscd).toHaveBeenCalledTimes(1);
			expect(callWscd).toHaveBeenCalledWith(
				'importContainer',
				ensureEncodedWscdContainer(container),
			);
		});

		it('rejects an invalid container before touching the bridge', async () => {
			const invalid = { keys: 'nope' } as unknown as WscdContainer;
			await expect(host.importContainer(invalid)).rejects.toThrow();
			expect(callWscd).not.toHaveBeenCalled();
		});

		it('propagates a bridge rejection', async () => {
			callWscd.mockRejectedValue(new Error('bridge boom'));
			await expect(host.importContainer(container)).rejects.toThrow(
				'bridge boom',
			);
		});
	});

	describe('exportContainer', () => {
		it('decodes the container the bridge returns', async () => {
			callWscd.mockResolvedValue(ensureEncodedWscdContainer(container));

			await expect(host.exportContainer()).resolves.toEqual(container);
			expect(callWscd).toHaveBeenCalledTimes(1);
			expect(callWscd).toHaveBeenCalledWith('exportContainer');
		});

		it('throws when the bridge returns a non-Uint8Array result', async () => {
			callWscd.mockResolvedValue(null);
			await expect(host.exportContainer()).rejects.toThrow(
				'Invalid container exported from native wrapper',
			);
		});

		it('throws when the returned bytes are not a valid container', async () => {
			callWscd.mockResolvedValue(new TextEncoder().encode('not json'));
			await expect(host.exportContainer()).rejects.toThrow();
		});

		it('propagates a bridge rejection', async () => {
			callWscd.mockRejectedValue(new Error('bridge boom'));
			await expect(host.exportContainer()).rejects.toThrow('bridge boom');
		});
	});
});
