import { assert, describe, it } from "vitest";
import { calculateByteSize } from "./calculateByteSize";

describe("calculateByteSize", () => {
	it.each([
		{ s: "", expected: 0 },
		{ s: "hello", expected: 5 },
		{ s: "café", expected: 5 }, // "é" is 2 bytes in UTF-8 but 1 character — proves byte size ≠ .length
	])("calculateByteSize($s) -> $expected", ({ s, expected }) => {
		assert.equal(calculateByteSize(s), expected);
	});
});
