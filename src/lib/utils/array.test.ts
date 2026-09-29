import { assert, describe, it } from "vitest";
import { compareBy, last, findIndexOrEnd, splitWhen, reverse, maxByKey, deduplicateBy, deduplicateFromRightBy } from "./array";

describe("compareBy", () => {
	it("sorts by Date objects as expected.", async () => {
		const a = new Date("2025-08-27T00:00:00Z");
		const b = new Date("2025-08-28T00:00:00Z");
		const c = new Date("2025-08-29T00:00:00Z");
		const list = [{ t: c }, { t: a }, { t: b }];
		const comp = compareBy((o: { t: Date }) => o.t);
		assert.deepEqual(list.flatMap(a => list.map(b => comp(a, b))), [0, 1, 1, -1, 0, -1, -1, 1, 0]);
		list.sort(comp);
		assert.deepEqual(list, [{ t: a }, { t: b }, { t: c }]);
	});
});

describe("last", () => {
	it.each<{ arr: (number | string)[]; expected: number | string | undefined }>([
		{ arr: [1, 2, 3], expected: 3 },
		{ arr: ["only"], expected: "only" },
		{ arr: [], expected: undefined },
	])("last($arr) -> $expected", ({ arr, expected }) => {
		assert.equal(last(arr), expected);
	});

	it.each([{ value: null }, { value: undefined }])("returns undefined for nullish input ($value)", ({ value }) => {
		assert.equal(last(value), undefined);
	});
});

describe("findIndexOrEnd", () => {
	it.each([
		{ arr: [1, 2, 3, 4], match: 3, expected: 2 },
		{ arr: [1, 2, 3], match: 99, expected: 3 },
		{ arr: [] as number[], match: 1, expected: 0 },
		{ arr: [5, 6, 7], match: 5, expected: 0 },
	])("findIndexOrEnd($arr, ===$match) -> $expected", ({ arr, match, expected }) => {
		assert.equal(findIndexOrEnd(arr, (n) => n === match), expected);
	});
});

describe("splitWhen", () => {
	it.each([
		{ arr: [1, 2, 3, 4], match: 3, before: [1, 2], from: [3, 4] },
		{ arr: [1, 2, 3], match: 1, before: [], from: [1, 2, 3] },
		{ arr: [1, 2, 3], match: 99, before: [1, 2, 3], from: [] },
		{ arr: [] as number[], match: 1, before: [], from: [] },
	])("splitWhen($arr, ===$match)", ({ arr, match, before, from }) => {
		const result = splitWhen(arr, (n) => n === match);
		assert.deepEqual(result, [before, from]);
		result[0].push(-1);
		assert.notDeepEqual(arr, result[0]);
	});
});

describe("reverse", () => {
	it.each([
		{ a: 1, b: 2 },
		{ a: 2, b: 1 },
		{ a: 1, b: 1 },
	])("reverse(asc)($a, $b) === -asc($a, $b)", ({ a, b }) => {
		const asc = (x: number, y: number) => x - y;
		assert.equal(reverse(asc)(a, b), -asc(a, b));
	});
});

describe("maxByKey", () => {
	it.each([
		{ arr: [{ n: 1 }, { n: 5 }, { n: 3 }], expected: { n: 5 } },
		{ arr: [] as { n: number }[], expected: undefined },
		{ arr: [{ n: 7 }], expected: { n: 7 } },
		{ arr: [{ n: 5, tag: "first" }, { n: 5, tag: "second" }], expected: { n: 5, tag: "first" } },
	])("maxByKey -> $expected", ({ arr, expected }) => {
		assert.deepEqual(maxByKey(arr, (o) => o.n), expected);
	});
});

describe("deduplicateBy", () => {
	it.each([
		{ arr: [3, 1, 2, 1, 3], expected: [3, 1, 2] },
		{ arr: [] as number[], expected: [] as number[] },
		{ arr: [1, 2, 3], expected: [1, 2, 3] },
	])("deduplicateBy($arr) -> $expected", ({ arr, expected }) => {
		assert.deepEqual(deduplicateBy(arr, (n) => n), expected);
	});
});

describe("deduplicateFromRightBy", () => {
	it("keeps the last value, at the first position, when there are duplicates", () => {
		const input = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 1, v: "c" }];
		assert.deepEqual(deduplicateFromRightBy(input, (o) => o.id), [{ id: 1, v: "c" }, { id: 2, v: "b" }]);
	});

	it("differs from deduplicateBy on a minimal duplicate pair", () => {
		const input = [{ id: 1, v: "a" }, { id: 1, v: "z" }];
		assert.equal(deduplicateBy(input, (o) => o.id)[0].v, "a");
		assert.equal(deduplicateFromRightBy(input, (o) => o.id)[0].v, "z");
	});

	it("returns an empty array for empty input", () => {
		assert.deepEqual(deduplicateFromRightBy([], (n) => n), []);
	});
});
