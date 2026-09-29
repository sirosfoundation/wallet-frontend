import { assert, describe, it } from "vitest";
import { getElementPropValue } from "./getElementPropValue";

describe("getElementPropValue", () => {
	it.each([
		{ obj: { a: 1 }, path: "a", expected: 1 },
		{ obj: { a: { b: 2 } }, path: "a.b", expected: 2 },
		{ obj: {}, path: "a", expected: undefined },
		{ obj: { a: {} }, path: "a.b.c", expected: undefined },
		{ obj: { a: undefined }, path: "a.b", expected: undefined },
		{ obj: { a: 0 }, path: "a.b", expected: 0 },
	])("getElementPropValue($obj, '$path') -> $expected", ({ obj, path, expected }) => {
		assert.equal(getElementPropValue(obj, path), expected);
	});
});
