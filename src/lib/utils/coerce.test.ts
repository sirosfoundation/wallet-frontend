import { assert, describe, it } from "vitest";
import { coerce } from "./coerce";

describe("coerce", () => {
	it.each([
		{ value: 5, label: "number" },
		{ value: "hello", label: "string" },
		{ value: true, label: "boolean" },
		{ value: null, label: "null" },
		{ value: undefined, label: "undefined" },
		{ value: { a: 1 }, label: "object (same reference)" },
		{ value: [1, 2, 3], label: "array (same reference)" },
	])("returns input unchanged: $label", ({ value }) => {
		assert.equal(coerce(value), value);
	});
});
