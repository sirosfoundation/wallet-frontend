import { assert, describe, it } from "vitest";
import { sanitizeId } from "./sanitizeId";

describe("sanitizeId", () => {
	it.each([
		{ value: "abc-123_XYZ", expected: "abc-123_XYZ" },
		{ value: "<script>alert(1)</script>", expected: "scriptalert1script" },
		{ value: 12345, expected: "12345" },
		{ value: "", expected: "" },
		{ value: "café", expected: "caf" },
	])("sanitizeId($value) -> $expected", ({ value, expected }) => {
		assert.equal(sanitizeId(value), expected);
	});
});
