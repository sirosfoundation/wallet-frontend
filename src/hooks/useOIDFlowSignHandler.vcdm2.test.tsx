import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// `useApi` reaches for network/session plumbing the presentation path never
// needs, so it is stubbed before the hook is imported.
vi.mock("@/api", () => ({
	useApi: () => ({ updatePrivateData: vi.fn(), getExternalEntity: vi.fn() }),
}));

import SessionContext from "@/context/SessionContext";
import StatusContext from "@/context/StatusContext";
import { useOIDFlowSignHandler } from "./useOIDFlowSignHandler";

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

function renderSignHandler(keystore: unknown) {
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
		const { result } = renderSignHandler(keystore);

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
		const { result } = renderSignHandler(keystore);

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
		const { result } = renderSignHandler(keystore);

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
		const { result } = renderSignHandler(keystore);
		const sdJwt = `${enc({ alg: "ES256", typ: "dc+sd-jwt" })}.${enc({ vct: "x" })}.sig~`;

		await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c4", credentialQueryId: "q4", credentialRaw: sdJwt }],
		});

		expect(keystore.signJwtPresentation).toHaveBeenCalledTimes(1);
		expect(keystore.signVcdm2Presentation).not.toHaveBeenCalled();
	});

	it("presents several credentials, keyed by their query ids", async () => {
		const { result } = renderSignHandler(keystore);

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
		const { result } = renderSignHandler(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c7", credentialQueryId: "q7", credentialRaw: "not-a-credential" }],
		})).rejects.toThrow(/Unsupported credential format for presentation signing/);
	});

	it("requires a nonce and an audience", async () => {
		const { result } = renderSignHandler(keystore);

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
		const { result } = renderSignHandler(keystore);

		await expect(result.current.signPresentation({ ...baseParams, credentialsToInclude: [] }))
			.rejects.toThrow(/No credentials to include/);
	});

	it("reports a credential that is missing from the cache", async () => {
		const { result } = renderSignHandler(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c8", credentialQueryId: "q8" }],
		})).rejects.toThrow(/Credential not in cache: c8/);
	});

	it("reports a credential with no query id", async () => {
		const { result } = renderSignHandler(keystore);

		await expect(result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c9", credentialRaw: envelopedVcdm2 }],
		})).rejects.toThrow(/Missing credentialQueryId for credential: c9/);
	});

	it("refuses to sign at all without a keystore", async () => {
		const { result } = renderSignHandler(undefined);

		await expect(result.current.handleSignRequest({
			action: "sign_presentation",
			params: {
				...baseParams,
				credentialsToInclude: [{ credentialId: "c", credentialQueryId: "q", credentialRaw: envelopedVcdm2 }],
			},
		})).rejects.toThrow(/Keystore not available/);
	});

	it("dispatches sign_presentation through handleSignRequest", async () => {
		const { result } = renderSignHandler(keystore);

		const response = await result.current.handleSignRequest({
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
		const { result } = renderSignHandler(keystore);

		await expect(result.current.handleSignRequest({ action: "something_else" as any, params: {} }))
			.rejects.toThrow(/Unknown sign action/);
	});
});

/**
 * DIIP v5 carries VCDM 2.0 inside an SD-JWT: a VCDM 2.0 body with no `vct`
 * and a trailing tilde. It is still an SD-JWT, so it presents through the
 * key-binding mechanism rather than a VCDM 2.0 presentation envelope.
 */
describe("useOIDFlowSignHandler — VCDM 2.0 carried in an SD-JWT", () => {
	const vcdm2SdJwt = `${enc({ alg: "ES256", typ: "vc+sd-jwt" })}.${enc(vcdm2Credential)}.sig~`;

	it("presents it through the SD-JWT signer, not the VCDM 2.0 envelope", async () => {
		const keystore = makeKeystore();
		const { result } = renderSignHandler(keystore);

		const response = await result.current.signPresentation({
			...baseParams,
			credentialsToInclude: [{ credentialId: "c1", credentialQueryId: "q1", credentialRaw: vcdm2SdJwt }],
		});

		expect(keystore.signJwtPresentation).toHaveBeenCalledTimes(1);
		expect(keystore.signVcdm2Presentation).not.toHaveBeenCalled();
		expect(JSON.parse(response.vpToken!)).toEqual({ q1: ["sdjwt-vp-token"] });
	});
});
