import { assert, describe, it } from "vitest";
import { toU8, toBase64, toBase64Url, byteArrayEquals, fromBase64, fromBase64Url, jsonStringifyTaggedBinary, jsonParseTaggedBinary, transformTaggedResponse } from "./binary";

describe("toU8", () => {
	it.each([
		{
			label: "whole ArrayBuffer",
			input: new Uint8Array([1, 2, 3]).buffer,
			expected: [1, 2, 3],
		},
		{
			label: "typed array view with byteOffset/byteLength",
			input: new Uint8Array(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3),
			expected: [2, 3, 4],
		},
	])("$label", ({ input, expected }) => {
		assert.deepEqual(toU8(input), new Uint8Array(expected));
	});
});

describe("toBase64", () => {
	it.each([
		{ bytes: [72, 101, 108, 108, 111], expected: "SGVsbG8=" }, // "Hello" — 1-char padding
		{ bytes: [0xff], expected: "/w==" }, // covers '/' + 2-char padding
		{ bytes: [0xf8], expected: "+A==" }, // covers '+' + 2-char padding
		{ bytes: [] as number[], expected: "" }, // empty input
	])("toBase64($bytes) -> $expected", ({ bytes, expected }) => {
		assert.equal(toBase64(new Uint8Array(bytes)), expected);
	});

	it("round-trips input spanning multiple 32KB chunks", () => {
		const bytes = new Uint8Array(70000).fill(65);
		assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
	});
});

describe("toBase64Url", () => {
	it.each([
		{ bytes: [0xff], expected: "_w" },
		{ bytes: [0xf8], expected: "-A" },
	])("replaces base64's URL-unsafe characters ($bytes -> $expected)", ({ bytes, expected }) => {
		assert.equal(toBase64Url(new Uint8Array(bytes)), expected);
	});
});

describe("byteArrayEquals", () => {
	it.each([
		{ a: [1, 2, 3], b: [1, 2, 3], expected: true },
		{ a: [1, 2, 3], b: [1, 2, 4], expected: false },
		{ a: [1, 2, 3], b: [1, 2], expected: false },
		{ a: [] as number[], b: [] as number[], expected: true },
	])("byteArrayEquals($a, $b) -> $expected", ({ a, b, expected }) => {
		assert.equal(byteArrayEquals(new Uint8Array(a), new Uint8Array(b)), expected);
	});
});

describe("fromBase64", () => {
	it.each([1, 2, 3, 4, 5])("round-trips a %i-byte array through toBase64/fromBase64", (len) => {
		const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) % 256);
		assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
	});

	it("throws on a string whose length is invalid for base64 (length % 4 === 1)", () => {
		assert.throws(() => fromBase64("A"));
	});
});

describe("fromBase64Url", () => {
	it.each([1, 2, 3, 4, 5])("round-trips a %i-byte array through toBase64Url/fromBase64Url", (len) => {
		const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) % 256);
		assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
	});
});

describe("jsonStringifyTaggedBinary", () => {
	it("tags binary values (Uint8Array, ArrayBuffer, nested) with a $b64u marker and leaves everything else untouched", () => {
		const binary = {
			key: new Uint8Array([1, 2, 3]),
			raw: new Uint8Array([9, 8, 7]).buffer,
			list: [{ id: 1, blob: new Uint8Array([1]) }],
		};
		const plain = { a: 1, b: "text", c: { nested: true } };

		const json = jsonStringifyTaggedBinary(binary);
		assert.equal(json.includes('"$b64u"'), true);
		assert.deepEqual(jsonParseTaggedBinary(json), { ...binary, raw: new Uint8Array([9, 8, 7]) });

		assert.equal(jsonStringifyTaggedBinary(plain), JSON.stringify(plain));
	});
});

describe("jsonParseTaggedBinary", () => {
	it("revives $b64u-tagged values (including ArrayBuffer input and nested tags) as Uint8Array, and leaves untagged JSON untouched", () => {
		const binary = {
			key: new Uint8Array([1, 2, 3]),
			raw: new Uint8Array([9, 8, 7]).buffer,
			list: [{ id: 1, blob: new Uint8Array([1]) }],
		};
		const result = jsonParseTaggedBinary(jsonStringifyTaggedBinary(binary));
		assert.deepEqual(result, { ...binary, raw: new Uint8Array([9, 8, 7]) });
		assert.equal(result.raw instanceof ArrayBuffer, false);

		const plain = { a: 1, b: "text", c: { nested: true } };
		assert.deepEqual(jsonParseTaggedBinary(JSON.stringify(plain)), plain);
	});
});

describe("transformTaggedResponse", () => {
	it.each([{ data: "" }, { data: null }, { data: undefined }])(
		"returns falsy input ($data) unchanged instead of attempting to parse it",
		({ data }) => {
			assert.equal(transformTaggedResponse(data), data);
		},
	);

	it("parses a truthy JSON string via jsonParseTaggedBinary", () => {
		const json = jsonStringifyTaggedBinary({ n: new Uint8Array([1, 2]) });
		assert.deepEqual(transformTaggedResponse(json), { n: new Uint8Array([1, 2]) });
	});
});
