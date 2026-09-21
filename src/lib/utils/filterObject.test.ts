import { assert, describe, it } from "vitest";
import { filterObject } from "./filterObject";

describe("filterObject", () => {
	it.each<{ obj: Record<string, number>; predicate: (v: number, k: string) => boolean; expected: Record<string, number> }>([
		{ obj: { a: 1, b: 2, c: 3 }, predicate: (v) => v > 1, expected: { b: 2, c: 3 } },
		{ obj: { a: 1, b: 2 }, predicate: (_v, k) => k === "a", expected: { a: 1 } },
		{ obj: {}, predicate: () => true, expected: {} },
		{ obj: { a: 1 }, predicate: () => false, expected: {} },
	])("filters entries by predicate", ({ obj, predicate, expected }) => {
		assert.deepEqual(filterObject(obj, predicate), expected);
	});
});
