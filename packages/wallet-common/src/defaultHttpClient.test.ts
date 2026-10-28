import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultHttpClient } from "./defaultHttpClient";

// The default client is @sirosfoundation/http-client with its axios transport;
// vi.mock is hoisted above the imports, so that transport sees this axios.
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("axios", () => ({ default: { request } }));

const served = `{\n  "vct": "urn:example:1"\n}`;

function respond(body: string, contentType = "application/json") {
	const bytes = new TextEncoder().encode(body);
	request.mockResolvedValue({ status: 200, headers: { "content-type": contentType }, data: bytes.buffer });
}

describe("defaultHttpClient", () => {
	beforeEach(() => request.mockReset());

	it("returns the parsed body, and no raw unless asked", async () => {
		respond(served);

		const res = await defaultHttpClient.get("https://x.test/a", {});

		expect(res.status).toBe(200);
		expect(res.data).toEqual({ vct: "urn:example:1" });
		expect(res.raw).toBeUndefined();
	});

	it("returns the body as served, as bytes, when asked for raw", async () => {
		respond(served);

		const res = await defaultHttpClient.get("https://x.test/b", {}, { wantRaw: true });

		expect(res.data).toEqual({ vct: "urn:example:1" });
		expect(res.raw).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(res.raw)).toBe(served);
	});

	it("passes raw through on post too", async () => {
		respond(`{"ok":true}`);

		const res = await defaultHttpClient.post("https://x.test/c", { q: 1 }, {}, { wantRaw: true });

		expect(res.data).toEqual({ ok: true });
		expect(new TextDecoder().decode(res.raw)).toBe(`{"ok":true}`);
		expect(request.mock.calls[0][0]).toMatchObject({ method: "POST", data: { q: 1 } });
	});
});
