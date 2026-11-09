import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createValidityAndStatusChecker, resolveIssuerIdentifier } from "./checkValidityAndStatus";
import { CredentialVerificationError } from "../error";
import { TokenStatus } from "../utils/tokenStatusList";
import { Context, HttpClient, PublicKeyResolverEngineI } from "../interfaces";

const { resolveTokenStatus } = vi.hoisted(() => ({ resolveTokenStatus: vi.fn() }));
vi.mock("../utils/tokenStatusList", async (importOriginal) => ({
	...(await importOriginal<typeof import("../utils/tokenStatusList")>()),
	resolveTokenStatus,
}));

const context = { clockTolerance: 5, lang: "en", subtle: globalThis.crypto.subtle } as Context;
const httpClient = { get: vi.fn(), post: vi.fn() } as unknown as HttpClient;
const issuerJwk = { kty: "EC", crv: "P-256", x: "x", y: "y" };
const pkResolverEngine = {
	resolve: vi.fn(),
	register: vi.fn(),
} as unknown as PublicKeyResolverEngineI & { resolve: ReturnType<typeof vi.fn> };

const now = Math.floor(Date.now() / 1000);
const statusClaims = (extra: Record<string, unknown> = {}) => ({
	iss: "https://issuer.example",
	status: { status_list: { idx: 3, uri: "https://issuer.example/status/1" } },
	...extra,
});

describe("resolveIssuerIdentifier", () => {
	it("prefers the JOSE iss claim", () => {
		expect(resolveIssuerIdentifier({ iss: "https://a.example", issuer: "https://b.example" })).toBe("https://a.example");
	});

	it("accepts a VCDM issuer string", () => {
		expect(resolveIssuerIdentifier({ issuer: "did:web:issuer.example" })).toBe("did:web:issuer.example");
	});

	it("accepts a VCDM issuer object with an id", () => {
		expect(resolveIssuerIdentifier({ issuer: { id: "did:web:issuer.example", name: "Issuer" } })).toBe("did:web:issuer.example");
	});

	it("returns null when there is no usable issuer", () => {
		expect(resolveIssuerIdentifier({})).toBeNull();
		expect(resolveIssuerIdentifier({ issuer: null })).toBeNull();
		expect(resolveIssuerIdentifier({ issuer: { name: "no id" } })).toBeNull();
	});
});

describe("createValidityAndStatusChecker", () => {
	const check = () => createValidityAndStatusChecker({ context, httpClient, pkResolverEngine });

	beforeEach(() => {
		resolveTokenStatus.mockReset();
		pkResolverEngine.resolve.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports an expired credential without consulting the status list", async () => {
		expect(await check()(statusClaims({ exp: now - 3600 }))).toBe(CredentialVerificationError.ExpiredCredential);
		expect(resolveTokenStatus).not.toHaveBeenCalled();
	});

	it("reports a credential that is not yet valid", async () => {
		expect(await check()({ nbf: now + 3600 })).toBe(CredentialVerificationError.NotYetValidCredential);
	});

	it("accepts a valid credential without a status reference", async () => {
		expect(await check()({ iss: "https://issuer.example", exp: now + 3600 })).toBeNull();
		expect(resolveTokenStatus).not.toHaveBeenCalled();
	});

	it("passes the reference, issuer, tolerance and a key resolver to the status list lookup", async () => {
		resolveTokenStatus.mockResolvedValue({ ok: true, status: TokenStatus.VALID });
		expect(await check()(statusClaims())).toBeNull();

		const args = resolveTokenStatus.mock.calls[0][0];
		expect(args.reference).toEqual({ idx: 3, uri: "https://issuer.example/status/1" });
		expect(args.expectedIssuer).toBe("https://issuer.example");
		expect(args.clockTolerance).toBe(5);
		expect(args.httpClient).toBe(httpClient);

		pkResolverEngine.resolve.mockResolvedValueOnce({ success: true, value: { jwk: issuerJwk } });
		expect(await args.resolveKey({ identifier: "https://issuer.example", kid: "k1" })).toEqual(issuerJwk);
		expect(pkResolverEngine.resolve).toHaveBeenCalledWith({ identifier: "https://issuer.example", kid: "k1" });

		pkResolverEngine.resolve.mockResolvedValueOnce({ success: false, error: "CannotResolve" });
		expect(await args.resolveKey({ identifier: "https://issuer.example" })).toBeNull();
	});

	it("leaves expectedIssuer undefined when the credential names no issuer", async () => {
		resolveTokenStatus.mockResolvedValue({ ok: true, status: TokenStatus.VALID });
		await check()({ status: { status_list: { idx: 0, uri: "https://issuer.example/status/1" } } });
		expect(resolveTokenStatus.mock.calls[0][0].expectedIssuer).toBeUndefined();
	});

	it("reports a revoked credential", async () => {
		resolveTokenStatus.mockResolvedValue({ ok: true, status: TokenStatus.INVALID });
		expect(await check()(statusClaims())).toBe(CredentialVerificationError.RevokedCredential);
	});

	it("reports a suspended credential", async () => {
		resolveTokenStatus.mockResolvedValue({ ok: true, status: TokenStatus.SUSPENDED });
		expect(await check()(statusClaims())).toBe(CredentialVerificationError.SuspendedCredential);
	});

	it("only warns when the status list cannot be reached, so offline wallets keep their credentials", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		resolveTokenStatus.mockResolvedValue({ ok: false, reason: "network error" });
		expect(await check()(statusClaims())).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("network error"));
	});
});
