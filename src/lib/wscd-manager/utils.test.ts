import { describe, it, expect, vi } from 'vitest';
import { calculateJwkThumbprint, type JWK } from 'jose';
import { WscdManagerError, WscdPlugin, type WscdContainer } from './resources';
import type { IWscdManagerHost } from './types';
import {
	ensureDecodedWscdContainer,
	ensureEncodedWscdContainer,
	exportWscdContainerToKeystore,
	hostNeedsContainerImportExport,
	requirementsForCredential,
} from './utils';

// A real P-256 public JWK so calculateJwkThumbprint produces a stable kid.
const publicKeyJwk: JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'hvLS5qgKNmpKnA46YSRft2AHyDk9QZGIuq2t8SXmtsE',
	y: '_O6ZbDIE6K_jmzgORF3DW-sSGVuigXIP9XMdPyGSOS0',
};

function makeContainer(): WscdContainer {
	return {
		keys: [{ kid: 'sw-abc', algorithm: 'ES256', d: 'ZmFrZQ', created_at: 0 }],
		lifecycle: {},
	};
}

function fakeHost(overrides: Partial<IWscdManagerHost> = {}): IWscdManagerHost {
	return {
		supportedPlugins: new Set([WscdPlugin.SOFTKEY]),
		exportPublicKey: vi.fn().mockResolvedValue(publicKeyJwk),
		...overrides,
	} as unknown as IWscdManagerHost;
}

describe('requirementsForCredential', () => {
	it('always requires the softkey plugin with no factors, ignoring the kid', () => {
		for (const kid of ['sw-1', 'thumbprint-xyz', '']) {
			expect(requirementsForCredential(kid)).toEqual({
				plugin: WscdPlugin.SOFTKEY,
				factors: [{ kind: 'none' }],
			});
		}
	});
});

describe('hostNeedsContainerImportExport', () => {
	it('is true when the host supports the softkey plugin', () => {
		expect(hostNeedsContainerImportExport(fakeHost())).toBe(true);
	});

	it('is false when the host does not support the softkey plugin', () => {
		const host = fakeHost({ supportedPlugins: new Set([WscdPlugin.R2PS]) });
		expect(hostNeedsContainerImportExport(host)).toBe(false);
	});
});

describe('ensureEncodedWscdContainer / ensureDecodedWscdContainer', () => {
	it('round-trips a valid container', () => {
		const container = makeContainer();
		const bytes = ensureEncodedWscdContainer(container);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(ensureDecodedWscdContainer(bytes)).toEqual(container);
	});

	it('throws WscdManagerError on an invalid container', () => {
		const invalid = { keys: 'nope' } as unknown as WscdContainer;
		expect(() => ensureEncodedWscdContainer(invalid)).toThrow(WscdManagerError);
	});

	it('throws WscdManagerError on a schema-invalid container', () => {
		const bytes = new TextEncoder().encode(JSON.stringify({ keys: 'nope' }));
		expect(() => ensureDecodedWscdContainer(bytes)).toThrow(WscdManagerError);
	});
});

describe('exportWscdContainerToKeystore', () => {
	it('enriches each key with its public key and thumbprint kid', async () => {
		const result = await exportWscdContainerToKeystore(
			fakeHost(),
			makeContainer(),
		);

		const expectedKid = await calculateJwkThumbprint(publicKeyJwk, 'sha256');
		expect(result.keys[0].publicKey).toEqual(publicKeyJwk);
		expect(result.keys[0].kid).toBe(expectedKid);
		// carries the rest of the key unchanged
		expect(result.keys[0].d).toBe('ZmFrZQ');
	});

	it('exports the public key using the original host handle', async () => {
		const host = fakeHost();
		await exportWscdContainerToKeystore(host, makeContainer());
		expect(host.exportPublicKey).toHaveBeenCalledWith('sw-abc');
	});

	it('does not mutate the input container', async () => {
		const input = makeContainer();
		await exportWscdContainerToKeystore(fakeHost(), input);
		expect(input.keys[0].kid).toBe('sw-abc');
		expect('publicKey' in input.keys[0]).toBe(false);
	});

	it('rejects when the exported public key is not a usable JWK', async () => {
		const host = fakeHost({ exportPublicKey: vi.fn().mockResolvedValue({}) });
		await expect(
			exportWscdContainerToKeystore(host, makeContainer()),
		).rejects.toThrow();
	});
});
