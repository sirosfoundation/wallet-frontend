import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultHttpClient } from "./defaultHttpClient";

// vi.mock is hoisted above the imports, so the client sees the mocked axios.

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({ default: { get, post } }));

const headers = { "content-type": "application/json" };

describe("defaultHttpClient", () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
	});

	it("returns the parsed body without raw unless asked", async () => {
		get.mockResolvedValue({ status: 200, data: { a: 1 }, headers });
		const res = await defaultHttpClient.get("https://x.test/a", {});
		expect(res).toEqual({ status: 200, data: { a: 1 }, headers });
		expect(get.mock.calls[0][1].transformResponse).toBeUndefined();
	});

	it("keeps the body as served and parses it itself when wantRaw is set", async () => {
		const served = `{\n  "a": 1\n}`;
		get.mockResolvedValue({ status: 200, data: served, headers });
		const res = await defaultHttpClient.get("https://x.test/a", {}, { wantRaw: true });
		expect(res).toEqual({ status: 200, data: { a: 1 }, headers, raw: served });

		const config = get.mock.calls[0][1];
		expect(config.wantRaw).toBeUndefined();
		expect(config.transformResponse[0](served)).toBe(served);
	});

	it("hands back non-JSON text as the body when wantRaw is set", async () => {
		get.mockResolvedValue({ status: 200, data: "<svg/>", headers });
		const res = await defaultHttpClient.get("https://x.test/a.svg", {}, { wantRaw: true });
		expect(res).toEqual({ status: 200, data: "<svg/>", headers, raw: "<svg/>" });
	});

	it("leaves raw undefined when the body did not arrive as text", async () => {
		get.mockResolvedValue({ status: 200, data: { a: 1 }, headers });
		const res = await defaultHttpClient.get("https://x.test/a", {}, { wantRaw: true });
		expect(res).toEqual({ status: 200, data: { a: 1 }, headers, raw: undefined });
	});

	it("returns null for an empty body", async () => {
		get.mockResolvedValue({ status: 204, data: "", headers });
		expect(await defaultHttpClient.get("https://x.test/a", {})).toBeNull();
	});

	it("returns the error body, or an empty object, on failure", async () => {
		get.mockRejectedValueOnce({ response: { data: { error: "nope" } } });
		expect(await defaultHttpClient.get("https://x.test/a", {})).toEqual({ error: "nope" });
		get.mockRejectedValueOnce(new Error("network"));
		expect(await defaultHttpClient.get("https://x.test/a", {})).toEqual({});
	});

	it("supports wantRaw on post", async () => {
		post.mockResolvedValue({ status: 200, data: `{"ok":true}`, headers });
		const res = await defaultHttpClient.post("https://x.test/a", { q: 1 }, {}, { wantRaw: true });
		expect(res).toEqual({ status: 200, data: { ok: true }, headers, raw: `{"ok":true}` });
		expect(post.mock.calls[0][1]).toEqual({ q: 1 });
	});

	it("posts without raw by default and maps failures like get", async () => {
		post.mockResolvedValueOnce({ status: 201, data: { id: 1 }, headers });
		expect(await defaultHttpClient.post("https://x.test/a", {}, {})).toEqual({ status: 201, data: { id: 1 }, headers });
		post.mockRejectedValueOnce({ response: { data: { error: "bad" } } });
		expect(await defaultHttpClient.post("https://x.test/a", {}, {})).toEqual({ error: "bad" });
	});
});
