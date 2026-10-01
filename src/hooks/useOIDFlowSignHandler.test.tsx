import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import SessionContext from '@/context/SessionContext';
import StatusContext from '@/context/StatusContext';

import {
	useOIDFlowSignHandler,
	type OIDFlowSignResponse,
} from './useOIDFlowSignHandler';

const mockPost = vi.fn();

vi.mock('@/api', async importOriginal => ({
	...(await importOriginal<typeof import('@/api')>()),
	useApi: () => ({
		post: mockPost,
		authTokens: { ensureBackendToken: async () => ({ raw: 'test-token' }) },
	}),
}));

vi.mock('@/config', async importOriginal => ({
	...(await importOriginal<typeof import('@/config')>()),
	WIA_ENABLED: true,
	BACKEND_URL: 'https://wallet-provider.example',
}));

vi.mock('./useHttpClient', () => ({
	useHttpClient: () => ({ post: mockPost }),
}));

// sign_client_auth never touches the WSCD client; stub it so the hook can
// mount without a WscdManagerClientContextProvider.
vi.mock('./useWscdManagerClient', () => ({
	useWscdManagerClient: () => ({
		signSdJwtPresentation: vi.fn(),
		generateDeviceResponse: vi.fn(),
		generateDeviceResponseForDCAPI: vi.fn(),
		generateDeviceResponseWithProximity: vi.fn(),
	}),
}));

vi.mock('@/context/SessionContext', async () => {
	const { createContext } =
		await vi.importActual<typeof import('react')>('react');
	const { generateKeyPair, exportJWK } =
		await vi.importActual<typeof import('jose')>('jose');
	const { generateRandomIdentifier } = await vi.importActual<
		typeof import('@/lib/utils/generateRandomIdentifier')
	>('@/lib/utils/generateRandomIdentifier');

	// Module-scoped store; each test uses a unique flowId (see note below).
	const store = new Map<
		string,
		{ dpopKeyId: string; keyPair: unknown; wia?: string }
	>();
	const oidFlowClientAuthMaterialManager = {
		async getAuthMaterial(flowId: string) {
			const existing = store.get(flowId);
			if (existing) return existing;
			const { privateKey, publicKey } = await generateKeyPair('ES256', {
				extractable: true,
			});
			const material = {
				dpopKeyId: generateRandomIdentifier(16),
				keyPair: { privateKey, publicKeyJwk: await exportJWK(publicKey) },
			};
			store.set(flowId, material);
			return material;
		},
		attachWia(flowId: string, wia: string) {
			const existing = store.get(flowId);
			if (existing) existing.wia = wia;
		},
	};

	return {
		default: createContext({
			keystore: {},
			authTokens: { ensureBackendToken: async () => ({ raw: 'test-token' }) },
			oidFlowClientAuthMaterialManager,
		}),
	};
});

vi.mock('@/context/StatusContext', async () => {
	const { createContext } =
		await vi.importActual<typeof import('react')>('react');
	return { default: createContext({ isOnline: true }) };
});

function primeWiaResponses() {
	mockPost
		.mockResolvedValueOnce({ data: { challenge: 'test-challenge' } })
		.mockResolvedValueOnce({
			data: { wallet_instance_attestation: 'signed.wia.jwt' },
		});
}

function renderSignHandler() {
	return renderHook(() => useOIDFlowSignHandler());
}

describe('useOIDFlowSignHandler / sign_client_auth', () => {
	beforeEach(() => {
		mockPost.mockReset();
	});

	// The per-flow key store is module-scoped and never cleared between tests,
	// so every test uses its own flowId to avoid reusing a prior test's cached
	// key + WIA.

	it('returns a client-held DPoP proof + WIA + fresh attestation PoP when enabled', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-full',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeTruthy();
		expect(res?.clientAttestation).toBe('signed.wia.jwt');
		expect(res?.clientAttestationPoP).toBeTruthy();

		// per-flow attestation PoP: iss = client_id, aud = the AS.
		const pop = decodeJwt(res!.clientAttestationPoP!);
		expect(pop.iss).toBe('https://wallet.example.com/cb');
		expect(pop.aud).toBe('https://as.example.com');
	});

	it('binds the WIA cnf key to the DPoP proof key (cnf == DPoP key, gap 1a)', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-1a',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		// The key that signs the DPoP proof...
		const dpopJwk = decodeProtectedHeader(res!.dpopProof!).jwk;
		// ...must be the same key the WIA was bound to (the WIA-request PoP,
		// posted to /wallet-provider/wia/generate, carries that key in its jwk
		// header).
		const [, generateBody] = mockPost.mock.calls[1];
		const wiaRequestJwk = decodeProtectedHeader(generateBody.pop).jwk;
		expect(dpopJwk).toEqual(wiaRequestJwk);
	});

	it('reuses the flow WIA but mints a fresh DPoP proof + PoP per request (gap 1b)', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		const req = {
			flowId: 'flow-1b',
			action: 'sign_client_auth' as const,
			params: {
				issuer: 'https://wallet.example.com/cb',
				audience: 'https://as.example.com',
				htm: 'POST',
				htu: 'https://as.example.com/token',
			},
		};

		let first: OIDFlowSignResponse | undefined;
		let second: OIDFlowSignResponse | undefined;
		await act(async () => {
			first = await result.current.handleSignRequest(req);
			second = await result.current.handleSignRequest(req);
		});

		// Same flow key + WIA reused (only one challenge/generate round-trip)...
		expect(first?.dpopKeyId).toBe(second?.dpopKeyId);
		expect(first?.clientAttestation).toBe(second?.clientAttestation);
		expect(mockPost).toHaveBeenCalledTimes(2);

		// ...but every proof and PoP is freshly signed (distinct jti).
		expect(decodeJwt(first!.dpopProof!).jti).not.toBe(
			decodeJwt(second!.dpopProof!).jti,
		);
		expect(decodeJwt(first!.clientAttestationPoP!).jti).not.toBe(
			decodeJwt(second!.clientAttestationPoP!).jti,
		);
	});

	it('addresses the WIA-request PoP to the wallet provider (BACKEND_URL), not the AS', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		await act(async () => {
			await result.current.handleSignRequest({
				flowId: 'flow-wia-aud',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(mockPost).toHaveBeenNthCalledWith(
			1,
			'https://wallet-provider.example/wallet-provider/wia/challenge',
			{},
			{ Authorization: 'Bearer test-token' },
		);
		const [path, body] = mockPost.mock.calls[1];
		expect(path).toBe('https://wallet-provider.example/wallet-provider/wia/generate');
		expect(decodeJwt(body.pop).aud).toBe('https://wallet-provider.example');
	});

	it('carries ath and dpop_nonce in the DPoP proof when the engine supplies them', async () => {
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-ath',
				action: 'sign_client_auth',
				// resource request: DPoP proof only (no audience), with ath + nonce.
				params: {
					htm: 'GET',
					htu: 'https://issuer.example.com/credential',
					ath: 'access-token-hash',
					dpopNonce: 'server-nonce',
				},
			});
		});

		const proof = decodeJwt(res!.dpopProof!);
		expect(proof.htm).toBe('GET');
		expect(proof.ath).toBe('access-token-hash');
		expect(proof.nonce).toBe('server-nonce');
		expect(res?.clientAttestation).toBeUndefined();
		expect(mockPost).not.toHaveBeenCalled();
	});

	it('returns a WIA but no DPoP proof when the engine asks for attestation only', async () => {
		primeWiaResponses();
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-wia-only',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeUndefined();
		expect(res?.clientAttestation).toBe('signed.wia.jwt');
	});

	it('still returns the DPoP proof (no attestation) when the WIA request fails', async () => {
		// challenge resolves without a challenge -> requestWIA returns undefined.
		mockPost.mockResolvedValueOnce({ data: {} });
		const { result } = renderSignHandler();

		let res: OIDFlowSignResponse | undefined;
		await act(async () => {
			res = await result.current.handleSignRequest({
				flowId: 'flow-degrade',
				action: 'sign_client_auth',
				params: {
					issuer: 'https://wallet.example.com/cb',
					audience: 'https://as.example.com',
					htm: 'POST',
					htu: 'https://as.example.com/token',
				},
			});
		});

		expect(res?.dpopKeyId).toBeTruthy();
		expect(res?.dpopProof).toBeTruthy();
		expect(res?.clientAttestation).toBeUndefined();
		expect(res?.clientAttestationPoP).toBeUndefined();
	});

	it('uses a distinct client-held key per flow', async () => {
		const { result } = renderSignHandler();

		let a: OIDFlowSignResponse | undefined;
		let b: OIDFlowSignResponse | undefined;
		await act(async () => {
			a = await result.current.handleSignRequest({
				flowId: 'flow-a',
				action: 'sign_client_auth',
				params: { htm: 'POST', htu: 'https://as.example.com/token' },
			});
			b = await result.current.handleSignRequest({
				flowId: 'flow-b',
				action: 'sign_client_auth',
				params: { htm: 'POST', htu: 'https://as.example.com/token' },
			});
		});

		expect(a?.dpopKeyId).not.toBe(b?.dpopKeyId);
		expect(decodeProtectedHeader(a!.dpopProof!).jwk).not.toEqual(
			decodeProtectedHeader(b!.dpopProof!).jwk,
		);
	});
});

const VCDM2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

function enc(value: object): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const vcdm2Credential = {
	"@context": [VCDM2_CONTEXT],
	type: ["VerifiableCredential", "DiplomaCredential"],
	issuer: "did:example:issuer",
	credentialSubject: { id: "did:example:subject" },
};

/** A VCDM 2.0 credential with an enveloping JOSE proof. */
const envelopedVcdm2 = `${enc({ alg: "ES256", typ: "vc+jwt" })}.${enc(vcdm2Credential)}.sig`;

/** The same credential secured with an embedded Data Integrity proof. */
const ldpVcdm2 = JSON.stringify({
	...vcdm2Credential,
	proof: {
		type: "DataIntegrityProof",
		cryptosuite: "ecdsa-rdfc-2019",
		verificationMethod: "did:example:issuer#key-1",
		proofPurpose: "assertionMethod",
		proofValue: "uAAAA",
	},
});

type PresentationArgs = [nonce: string, audience: string, credentials: unknown[], transactionData?: unknown];

function makeKeystore() {
	return {
		// Parameters are declared so the recorded calls stay typed, which is
		// what lets the assertions below inspect the arguments.
		signVcdm2Presentation: vi.fn(async (..._args: PresentationArgs) => ({ vpjwt: "vcdm2-vp-token" })),
		signJwtPresentation: vi.fn(async (..._args: PresentationArgs) => ({ vpjwt: "sdjwt-vp-token" })),
		generateDeviceResponse: vi.fn(),
	};
}

function renderSignHandlerWithKeystore(keystore: unknown) {
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<StatusContext.Provider value={{ isOnline: true } as any}>
			<SessionContext.Provider value={{ keystore } as any}>
				{children}
			</SessionContext.Provider>
		</StatusContext.Provider>
	);

	return renderHook(() => useOIDFlowSignHandler(), { wrapper });
}

const baseParams = {
	nonce: "n-1",
	audience: "https://verifier.example",
};

describe("useOIDFlowSignHandler — VCDM 2.0 presentation", () => {
	let keystore: ReturnType<typeof makeKeystore>;

	beforeEach(() => {
		keystore = makeKeystore();
	});

	it("routes an enveloped VCDM 2.0 credential to signVcdm2Presentation", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		const response = await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{
				credentialId: "c1",
				credentialQueryId: "q1",
				credentialRaw: envelopedVcdm2,
			}],
		});

		expect(keystore.signVcdm2Presentation).toHaveBeenCalledTimes(1);
		expect(keystore.signJwtPresentation).not.toHaveBeenCalled();

		// The raw compact JWS is handed over unchanged, so it can be wrapped
		// as an EnvelopedVerifiableCredential.
		const [nonce, audience, credentials] = keystore.signVcdm2Presentation.mock.calls[0];
		expect(nonce).toBe("n-1");
		expect(audience).toBe("https://verifier.example");
		expect(credentials).toEqual([envelopedVcdm2]);

		expect(JSON.parse(response.vpToken!)).toEqual({ q1: ["vcdm2-vp-token"] });
	});

	it("parses a Data Integrity credential into an object before presenting it", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{
				credentialId: "c2",
				credentialQueryId: "q2",
				credentialRaw: ldpVcdm2,
			}],
		});

		const [, , credentials] = keystore.signVcdm2Presentation.mock.calls[0];
		// An object, not the JSON string: embedding the string would
		// double-encode the credential inside the presentation.
		expect(typeof credentials[0]).toBe("object");
		expect(credentials[0]).toEqual(JSON.parse(ldpVcdm2));
	});

	it("ignores disclosedClaims, which VCDM 2.0 cannot honour", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{
				credentialId: "c3",
				credentialQueryId: "q3",
				credentialRaw: envelopedVcdm2,
				disclosedClaims: ["degree"],
			}],
		});

		// The whole credential is presented; no filtering is attempted.
		const [, , credentials] = keystore.signVcdm2Presentation.mock.calls[0];
		expect(credentials).toEqual([envelopedVcdm2]);
	});

	it("still routes SD-JWT credentials to the SD-JWT signer", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);
		const sdJwt = `${enc({ alg: "ES256", typ: "dc+sd-jwt" })}.${enc({ vct: "x" })}.sig~`;

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c4", credentialQueryId: "q4", credentialRaw: sdJwt }],
		});

		expect(keystore.signJwtPresentation).toHaveBeenCalledTimes(1);
		expect(keystore.signVcdm2Presentation).not.toHaveBeenCalled();
	});

	it("presents several credentials, keyed by their query ids", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		const response = await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [
				{ credentialId: "c5", credentialQueryId: "q5", credentialRaw: envelopedVcdm2 },
				{ credentialId: "c6", credentialQueryId: "q6", credentialRaw: ldpVcdm2 },
			],
		});

		expect(keystore.signVcdm2Presentation).toHaveBeenCalledTimes(2);
		expect(JSON.parse(response.vpToken!)).toEqual({
			q5: ["vcdm2-vp-token"],
			q6: ["vcdm2-vp-token"],
		});
	});

	it("rejects a credential format it cannot present", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c7", credentialQueryId: "q7", credentialRaw: "not-a-credential" }],
		})).rejects.toThrow(/Unsupported credential format for presentation signing/);
	});

	it("requires a nonce and an audience", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.signPresentation({
			audience: "aud",
			credentialsToInclude: [{ credentialId: "c", credentialQueryId: "q", credentialRaw: envelopedVcdm2 }],
		})).rejects.toThrow(/Missing audience or nonce/);

		await expect(result.current.signPresentation({
			nonce: "n",
			credentialsToInclude: [{ credentialId: "c", credentialQueryId: "q", credentialRaw: envelopedVcdm2 }],
		})).rejects.toThrow(/Missing audience or nonce/);
	});

	it("requires at least one credential", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.signPresentation({ ...baseParams, credentialsToInclude: [] }))
			.rejects.toThrow(/No credentials to include/);
	});

	it("reports a credential that is missing from the cache", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c8", credentialQueryId: "q8" }],
		})).rejects.toThrow(/Credential not in cache: c8/);
	});

	it("reports a credential with no query id", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c9", credentialRaw: envelopedVcdm2 }],
		})).rejects.toThrow(/Missing credentialQueryId for credential: c9/);
	});

	it("refuses to sign at all without a keystore", async () => {
		const { result } = renderSignHandlerWithKeystore(undefined);

		await expect(result.current.handleSignRequest({
			flowId: "flow-1",
			action: "sign_presentation",
			params: {
				...baseParams,
				credentialsToInclude: [{ credentialId: "c", credentialQueryId: "q", credentialRaw: envelopedVcdm2 }],
			},
		})).rejects.toThrow(/Keystore not available/);
	});

	it("dispatches sign_presentation through handleSignRequest", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		const response = await result.current.handleSignRequest({
			flowId: "flow-1",
			action: "sign_presentation",
			params: {
				...baseParams,
				credentialsToInclude: [{ credentialId: "c", credentialQueryId: "q", credentialRaw: envelopedVcdm2 }],
			},
		});

		expect(keystore.signVcdm2Presentation).toHaveBeenCalledTimes(1);
		expect(JSON.parse(response.vpToken!)).toEqual({ q: ["vcdm2-vp-token"] });
	});

	it("rejects an unknown sign action", async () => {
		const { result } = renderSignHandlerWithKeystore(keystore);

		await expect(result.current.handleSignRequest({ flowId: "flow-1", action: "something_else" as any, params: {} }))
			.rejects.toThrow(/Unknown sign action/);
	});
});

/**
 * DIIP v5 carries VCDM 2.0 inside an SD-JWT: a VCDM 2.0 body with no `vct`
 * and a trailing tilde.
 *
 * `vc+sd-jwt` is VC-JOSE-COSE's media type for a VCDM 2.0 credential secured
 * as an SD-JWT; an IETF SD-JWT VC is `dc+sd-jwt`. So a verifier requesting
 * `vc+sd-jwt` expects a VCDM 2.0 VerifiablePresentation, not a bare SD-JWT
 * with a key-binding JWT.
 */
describe("useOIDFlowSignHandler — VCDM 2.0 carried in an SD-JWT", () => {
	const vcdm2SdJwt = `${enc({ alg: "ES256", typ: "vc+sd-jwt" })}.${enc(vcdm2Credential)}.sig~`;

	it("presents it as a VCDM 2.0 presentation, not through the SD-JWT signer", async () => {
		const keystore = makeKeystore();
		const { result } = renderSignHandlerWithKeystore(keystore);

		const response = await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c1", credentialQueryId: "q1", credentialRaw: vcdm2SdJwt }],
		});

		expect(keystore.signVcdm2Presentation).toHaveBeenCalledTimes(1);
		expect(keystore.signJwtPresentation).not.toHaveBeenCalled();
		expect(JSON.parse(response.vpToken!)).toEqual({ q1: ["vcdm2-vp-token"] });
	});

	it("hands over the raw SD-JWT unchanged, so it can be enveloped", async () => {
		const keystore = makeKeystore();
		const { result } = renderSignHandlerWithKeystore(keystore);

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c2", credentialQueryId: "q2", credentialRaw: vcdm2SdJwt }],
		});

		// The compact SD-JWT goes through as a string: wallet-common wraps it
		// as an EnvelopedVerifiableCredential naming `application/vc+sd-jwt`.
		const [, , credentials] = keystore.signVcdm2Presentation.mock.calls[0];
		expect(credentials).toEqual([vcdm2SdJwt]);
	});

	it("still routes a dc+sd-jwt credential to the SD-JWT signer", async () => {
		// The other side of the line: an IETF SD-JWT VC keeps its key-binding
		// presentation, which is what its own spec defines.
		const keystore = makeKeystore();
		const { result } = renderSignHandlerWithKeystore(keystore);
		const sdJwtVc = `${enc({ alg: "ES256", typ: "dc+sd-jwt" })}.${enc({ vct: "urn:eduid" })}.sig~`;

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c3", credentialQueryId: "q3", credentialRaw: sdJwtVc }],
		});

		expect(keystore.signJwtPresentation).toHaveBeenCalledTimes(1);
		expect(keystore.signVcdm2Presentation).not.toHaveBeenCalled();
	});
});
