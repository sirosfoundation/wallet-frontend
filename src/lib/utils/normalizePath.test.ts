import { assert, describe, it } from "vitest";
import { normalizePath } from "./normalizePath";

describe("normalizePath", () => {
	it.each([
		{ path: "$.a.b.c", expected: ["a", "b", "c"] },
		{ path: "a.b.c", expected: ["a.b.c"] },
	])("normalizePath($path) -> $expected", ({ path, expected }) => {
		assert.deepEqual(normalizePath(path), expected);
	});

	it("returns the same array reference when given an array (no copy)", () => {
		const arr = ["a", "b"];
		assert.equal(normalizePath(arr), arr);
	});
});
