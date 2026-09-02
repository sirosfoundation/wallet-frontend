import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import * as jose from 'jose';
import { SDJwt } from '@sd-jwt/core';
import { validateChain } from '../../utils/pki';
import { logger } from '@/logger';
import { verifySdJwtBasedOnTrustAnchors, applySelectiveDisclosure } from './sd-jwt';

vi.mock('../../utils/pki', () => ({
	fromPemToPKIJSCertificate: vi.fn(() => ({})),
	toPem: vi.fn((cert: string) => cert),
	getPublicKeyFromB64Cert: vi.fn(() => '-----BEGIN CERTIFICATE-----'),
	validateChain: vi.fn(),
}));

vi.mock('@/logger', () => ({
	logger: { error: vi.fn() },
}));

vi.mock('@sd-jwt/core', () => ({
	SDJwt: { fromEncode: vi.fn() },
}));

// Keep jose's real base64url so header parsing works, but stub the crypto calls.
vi.mock('jose', async (importOriginal) => {
	const actual = await importOriginal<typeof import('jose')>();
	return { ...actual, importX509: vi.fn(), jwtVerify: vi.fn() };
});

const mockValidateChain = validateChain as Mock;
const mockImportX509 = jose.importX509 as Mock;
const mockJwtVerify = jose.jwtVerify as Mock;
const mockFromEncode = SDJwt.fromEncode as unknown as Mock;
const mockLoggerError = logger.error as Mock;

describe('verifySdJwtBasedOnTrustAnchors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns false when the certificate chain is invalid', async () => {
		mockValidateChain.mockResolvedValue(false);

		const result = await verifySdJwtBasedOnTrustAnchors(buildSdJwt());

		expect(result).toBe(false);
		expect(mockImportX509).not.toHaveBeenCalled();
		expect(mockJwtVerify).not.toHaveBeenCalled();
	});

	it('returns true when the chain is valid and the signature verifies', async () => {
		mockValidateChain.mockResolvedValue(true);
		mockImportX509.mockResolvedValue({} as CryptoKey);
		mockJwtVerify.mockResolvedValue({} as never);

		const result = await verifySdJwtBasedOnTrustAnchors(buildSdJwt());

		expect(result).toBe(true);
		expect(mockJwtVerify).toHaveBeenCalledOnce();
	});

	it('returns false and logs when signature verification fails', async () => {
		mockValidateChain.mockResolvedValue(true);
		mockImportX509.mockResolvedValue({} as CryptoKey);
		mockJwtVerify.mockRejectedValue(new Error('bad signature'));

		const result = await verifySdJwtBasedOnTrustAnchors(buildSdJwt());

		expect(result).toBe(false);
		expect(mockLoggerError).toHaveBeenCalled();
	});
});

describe('applySelectiveDisclosure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the credential unchanged when there are no disclosures', async () => {
		const credential = 'header.payload.signature';

		const result = await applySelectiveDisclosure(credential, ['email']);

		expect(result).toBe(credential);
		expect(mockFromEncode).not.toHaveBeenCalled();
	});

	it('presents only the requested claims using a nested disclosure frame', async () => {
		const present = vi.fn().mockResolvedValue('presented-sd-jwt');
		mockFromEncode.mockResolvedValue({ present });

		const result = await applySelectiveDisclosure('header.payload.sig~disclosure1~disclosure2~', [
			'email',
			'address.street',
		]);

		expect(result).toBe('presented-sd-jwt');
		expect(present).toHaveBeenCalledWith(
			{ email: true, address: { street: true } },
			expect.any(Function),
		);
	});
});

function buildSdJwt(): string {
	const header = jose.base64url.encode(
		new TextEncoder().encode(JSON.stringify({ alg: 'ES256', x5c: ['MIIBfakeCert'] })),
	);
	return `${header}.eyJzdWIiOiJ0ZXN0In0.signature`;
}
