import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
	base64url,
	calculateJwkThumbprint,
	decodeJwt,
	decodeProtectedHeader,
	type JWK,
} from 'jose';
import {
	buildOid4vpDcApiSessionTranscript,
	buildOid4vpSessionTranscript,
	generateMdocDeviceResponse,
	prepareSdJwtPresentation,
} from '../verifiable-credentials';
import { WscdManagerClient } from './WscdManagerClient';
import {
	WscdHostStrength,
	WscdManagerHosts,
	WscdPlugin,
	type WscdContainer,
} from './resources';
import type { GenerateDeviceResponseRequest, IWscdManagerHost } from './types';

// Keep the real host modules (wasm/worker imports) out of the test; hosts are
// injected via the constructor instead. vi.mock is hoisted above imports.
vi.mock('./hosts/WscdManagerInPageHost', () => ({
	WscdManagerInPageHost: class {},
}));
vi.mock('./hosts/WscdManagerWorkerHost', () => ({
	WscdManagerWorkerHost: class {},
}));
vi.mock('@/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../verifiable-credentials', () => ({
	prepareSdJwtPresentation: vi.fn(),
	generateMdocDeviceResponse: vi.fn(),
	buildOid4vpSessionTranscript: vi.fn(),
	buildOid4vpDcApiSessionTranscript: vi.fn(),
}));

const publicKeyJwk: JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'hvLS5qgKNmpKnA46YSRft2AHyDk9QZGIuq2t8SXmtsE',
	y: '_O6ZbDIE6K_jmzgORF3DW-sSGVuigXIP9XMdPyGSOS0',
};

const publicKeyKid = 'q95J3MNIjVVGXyrmJVm5Vfr6E-iGfIF0Bo4XZAGhFf4'

function makeContainer(): WscdContainer {
	return {
		keys: [{ kid: publicKeyKid, algorithm: 'ES256', d: 'ZmFrZQ', created_at: 0 }],
		lifecycle: {},
	};
}

function fakeHost(overrides: Partial<IWscdManagerHost> = {}): IWscdManagerHost {
	return {
		id: WscdManagerHosts.IN_PAGE,
		strength: WscdHostStrength.IN_PAGE,
		supportedPlugins: new Set([WscdPlugin.SOFTKEY]),
		initialize: vi.fn().mockResolvedValue(undefined),
		isAvailable: vi.fn().mockResolvedValue(true),
		isEligible: vi.fn().mockResolvedValue(true),
		sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
		generateKey: vi.fn().mockResolvedValue(publicKeyKid),
		exportPublicKey: vi.fn().mockResolvedValue(publicKeyJwk),
		importContainer: vi.fn().mockResolvedValue(undefined),
		exportContainer: vi.fn().mockResolvedValue(makeContainer()),
		...overrides,
	};
}

function makeClient(hosts: IWscdManagerHost[]): {
	client: WscdManagerClient;
	importer: Mock;
	exporter: Mock;
} {
	const client = new WscdManagerClient(hosts);
	const importer = vi.fn().mockResolvedValue(makeContainer());
	const exporter = vi.fn().mockResolvedValue(undefined);
	client.setContainerImporter(importer);
	client.setContainerExporter(exporter);
	return { client, importer, exporter };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('generateKeypairs', () => {
	it('mints keys with thumbprint kids and seeds + persists the container', async () => {
		const host = fakeHost();
		const { client, importer, exporter } = makeClient([host]);

		const keys = await client.generateKeypairs(2);

		const expectedKid = await calculateJwkThumbprint(publicKeyJwk, 'sha256');
		expect(keys).toEqual([
			{ kid: expectedKid, publicKey: publicKeyJwk },
			{ kid: expectedKid, publicKey: publicKeyJwk },
		]);
		expect(host.generateKey).toHaveBeenCalledTimes(2);
		expect(importer).toHaveBeenCalledTimes(1);
		expect(exporter).toHaveBeenCalledTimes(1);
	});
});

describe('generateOpenid4vciProofs', () => {
	it('returns a signed openid4vci-proof+jwt per request', async () => {
		const signature = new Uint8Array([9, 9, 9]);
		const host = fakeHost({ sign: vi.fn().mockResolvedValue(signature) });
		const { client, exporter } = makeClient([host]);

		const [proof] = await client.generateOpenid4vciProofs([
			{ nonce: 'the-nonce', audience: 'the-aud', issuer: 'the-iss' },
		]);

		const header = decodeProtectedHeader(proof);
		expect(header).toMatchObject({ alg: 'ES256', typ: 'openid4vci-proof+jwt' });
		expect((header.jwk as JWK).kty).toBe('EC');

		const payload = decodeJwt(proof);
		expect(payload).toMatchObject({
			nonce: 'the-nonce',
			aud: 'the-aud',
			iss: 'the-iss',
		});
		expect(payload.iat).toEqual(expect.any(Number));

		expect(proof.split('.')[2]).toBe(base64url.encode(signature));
		expect(exporter).toHaveBeenCalledTimes(1);
	});
});

describe('signSdJwtPresentation', () => {
	it('assembles the vp jwt from the prepared input and host signature', async () => {
		(prepareSdJwtPresentation as Mock).mockResolvedValue({
			kid: 'holder-kid',
			sdJwt: 'SD~',
			signingInput: 'HEADER.PAYLOAD',
		});
		const signature = new Uint8Array([7, 7, 7]);
		const host = fakeHost({ sign: vi.fn().mockResolvedValue(signature) });
		const { client } = makeClient([host]);

		const vpjwt = await client.signSdJwtPresentation({
			audience: 'aud',
			nonce: 'nonce',
			verifiableCredentials: ['vc'],
		});

		expect(vpjwt).toBe(`SD~HEADER.PAYLOAD.${base64url.encode(signature)}`);
		expect(host.sign).toHaveBeenCalledWith(
			'holder-kid',
			new TextEncoder().encode('HEADER.PAYLOAD'),
		);
	});
});

describe('generateDeviceResponse', () => {
	it('builds the OID4VP transcript and returns the device response bytes', async () => {
		(buildOid4vpSessionTranscript as Mock).mockResolvedValue('transcript');
		const bytes = new Uint8Array([4, 5, 6]);
		(generateMdocDeviceResponse as Mock).mockResolvedValue(bytes);
		const { client } = makeClient([fakeHost()]);

		const sessionTranscript =
			{} as GenerateDeviceResponseRequest['sessionTranscript'];
		const result = await client.generateDeviceResponse({
			credential: 'cred',
			disclosedClaims: ['ns.field'],
			sessionTranscript,
		});

		expect(result).toBe(bytes);
		expect(buildOid4vpSessionTranscript).toHaveBeenCalledWith(
			sessionTranscript,
		);
		expect(generateMdocDeviceResponse).toHaveBeenCalledWith(
			'cred',
			['ns.field'],
			'transcript',
			expect.any(Function),
		);
	});
});

describe('generateDeviceResponseForDCAPI', () => {
	it('builds the DC API transcript', async () => {
		(buildOid4vpDcApiSessionTranscript as Mock).mockResolvedValue(
			'dcapi-transcript',
		);
		const bytes = new Uint8Array([1]);
		(generateMdocDeviceResponse as Mock).mockResolvedValue(bytes);
		const { client } = makeClient([fakeHost()]);

		const result = await client.generateDeviceResponseForDCAPI({
			credential: 'cred',
			disclosedClaims: ['ns.field'],
			sessionTranscript: {} as never,
		});

		expect(result).toBe(bytes);
		expect(buildOid4vpDcApiSessionTranscript).toHaveBeenCalledTimes(1);
	});
});

describe('#selectHost', () => {
	it('routes to the strongest eligible host', async () => {
		const inPage = fakeHost({
			id: WscdManagerHosts.IN_PAGE,
			strength: WscdHostStrength.IN_PAGE,
		});
		const worker = fakeHost({
			id: WscdManagerHosts.WORKER,
			strength: WscdHostStrength.WORKER,
		});
		const { client } = makeClient([inPage, worker]);

		await client.generateKeypairs(1);

		expect(worker.generateKey).toHaveBeenCalled();
		expect(inPage.generateKey).not.toHaveBeenCalled();
	});

	it('throws when no host is eligible', async () => {
		const host = fakeHost({ isEligible: vi.fn().mockResolvedValue(false) });
		const { client } = makeClient([host]);

		await expect(client.generateKeypairs(1)).rejects.toThrow(
			'No eligible WSCD host',
		);
	});
});

describe('container callbacks', () => {
	it('throws when the import callback is missing', async () => {
		const client = new WscdManagerClient([fakeHost()]);
		await expect(client.generateKeypairs(1)).rejects.toThrow(
			'Container import callback not set',
		);
	});

	it('throws when the export callback is missing', async () => {
		const client = new WscdManagerClient([fakeHost()]);
		client.setContainerImporter(vi.fn().mockResolvedValue(makeContainer()));
		await expect(client.generateKeypairs(1)).rejects.toThrow(
			'Container export callback not set',
		);
	});

	it('skips import/export for a host that does not hold a container', async () => {
		const host = fakeHost({ supportedPlugins: new Set([WscdPlugin.R2PS]) });
		const client = new WscdManagerClient([host]);

		const keys = await client.generateKeypairs(1);

		expect(keys).toHaveLength(1);
		expect(host.importContainer).not.toHaveBeenCalled();
		expect(host.exportContainer).not.toHaveBeenCalled();
	});
});
