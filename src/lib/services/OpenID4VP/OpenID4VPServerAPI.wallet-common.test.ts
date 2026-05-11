import { describe, expect, it, vi } from "vitest";
import {
	HandleAuthorizationRequestErrors,
	OpenID4VPResponseMode,
	OpenID4VPServerAPI,
	OpenID4VPServerCredential,
} from "wallet-common";

function createServer(rpStateStore: {
	store: (stateObject: any) => Promise<void>;
	retrieve: () => Promise<any>;
}) {
	return new OpenID4VPServerAPI<OpenID4VPServerCredential, unknown>({
		httpClient: { get: vi.fn() },
		rpStateStore,
		parseCredential: vi.fn(),
		selectCredentialForBatch: vi.fn(),
		keystore: {
			signJwtPresentation: vi.fn(),
			generateDeviceResponse: vi.fn(),
		},
		strings: {
			purposeNotSpecified: "purpose",
			allClaimsRequested: "all claims",
		},
		lastUsedNonceStore: {
			get: vi.fn(() => null),
			set: vi.fn(),
		},
		evaluateTrust: vi.fn(async () => ({ trusted: true } as any)),
	});
}

describe("wallet-common OpenID4VPServerAPI integration", () => {
	it("accepts plain response_mode query values without JSON parsing", async () => {
		const server = createServer({
			store: vi.fn(),
			retrieve: vi.fn(),
		});
		const url = "https://wallet.example/auth?client_id=https%3A%2F%2Fverifier.example&response_mode=dc_api";

		const result = await server.handleAuthorizationRequest(url, []);

		expect(result).toEqual({
			error: HandleAuthorizationRequestErrors.MISSING_DCQL_QUERY,
		});
	});

	it("returns response_mode from createAuthorizationResponse", async () => {
		const server = createServer({
			store: vi.fn(),
			retrieve: vi.fn(async () => ({
				nonce: "nonce-1",
				response_uri: "https://verifier.example/response",
				client_id: "https://verifier.example",
				state: "state-1",
				client_metadata: { vp_formats: {} },
				response_mode: OpenID4VPResponseMode.DC_API,
				transaction_data: [],
				dcql_query: {},
			})),
		});

		(server as any).handleDCQLFlow = vi.fn(async () => ({
			formData: new URLSearchParams("vp_token=test"),
			generatedVPs: [],
			presentationSubmission: { id: "1", descriptor_map: [] },
			filteredVCEntities: [],
		}));

		const response = await server.createAuthorizationResponse(new Map(), []);

		expect(response).toMatchObject({
			response_uri: "https://verifier.example/response",
			client_id: "https://verifier.example",
			state: "state-1",
			response_mode: OpenID4VPResponseMode.DC_API,
		});
	});
});
