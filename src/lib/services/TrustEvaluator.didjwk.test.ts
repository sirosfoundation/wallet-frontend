import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveDidJwk ships in wallet-common#35, so it cannot be spied on the installed package the
// way the sibling tests spy on AuthZENClient — the export is not there until the re-pin. The
// module is mocked instead, which also lets these tests assert that the backend is left alone.
const { resolveDidJwk, resolve } = vi.hoisted(() => ({
	resolveDidJwk: vi.fn(),
	resolve: vi.fn(),
}));

vi.mock('wallet-common', async (importOriginal) => ({
	...(await importOriginal<typeof import('wallet-common')>()),
	resolveDidJwk,
	AuthZENClient: () => ({ resolve }),
}));

const { createDIDResolver } = await import('./TrustEvaluator');

const config = {
	httpClient: {} as never,
	backendUrl: 'https://backend.example',
	getAuthToken: () => 'token',
	tenantId: 'default',
};

// A did:jwk carries its own key, so there is nothing for a trust backend to look up. Resolving
// it locally is what lets the wallet accept a DIIP v5 Verifier at all.
describe('createDIDResolver with did:jwk', () => {
	beforeEach(() => {
		resolveDidJwk.mockReset();
		resolve.mockReset();
	});

	it('resolves a did:jwk without calling the backend', async () => {
		const didDocument = { id: 'did:jwk:eyJrdHkiOiJFQyJ9' };
		resolveDidJwk.mockReturnValue({ resolved: true, didDocument });

		const result = await createDIDResolver(config)('did:jwk:eyJrdHkiOiJFQyJ9');

		expect(result.resolved).toBe(true);
		expect(result.didDocument).toEqual(didDocument);
		expect(resolveDidJwk).toHaveBeenCalledWith('did:jwk:eyJrdHkiOiJFQyJ9');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('reports a malformed did:jwk rather than falling back to the backend', async () => {
		// Falling back would ask the PDP to resolve something only the identifier itself can
		// answer, turning a bad identifier into a confusing trust failure.
		resolveDidJwk.mockReturnValue({ resolved: false, error: 'invalid did:jwk' });

		const result = await createDIDResolver(config)('did:jwk:not-base64url');

		expect(result.resolved).toBe(false);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('still sends other DID methods to the backend', async () => {
		resolve.mockResolvedValue({
			ok: true,
			value: { context: { trust_metadata: { id: 'did:web:verifier.example.com' } } },
		});

		const result = await createDIDResolver(config)('did:web:verifier.example.com');

		expect(result.resolved).toBe(true);
		expect(resolve).toHaveBeenCalledWith('did:web:verifier.example.com');
		expect(resolveDidJwk).not.toHaveBeenCalled();
	});
});
