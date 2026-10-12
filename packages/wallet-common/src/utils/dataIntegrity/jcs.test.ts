import { describe, expect, it } from 'vitest';
import { canonicalizeJcs } from './jcs';

describe('canonicalizeJcs', () => {
	it('sorts object keys by UTF-16 code unit', () => {
		expect(canonicalizeJcs({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
	});

	it('preserves array order', () => {
		expect(canonicalizeJcs([3, 1, 2])).toBe('[3,1,2]');
	});

	it('orders the RFC 8785 §3.2.3 example keys by code unit', () => {
		// Keys chosen by the RFC to exercise code-unit rather than
		// code-point ordering: U+000D < "1" < U+0080 < U+20AC.
		const input = {
			'€': 'Euro Sign',
			'\r': 'Carriage Return',
			'1': 'One',
			'\u0080': 'Control',
		};
		// Only U+0000..U+001F are escaped, so U+0080 and U+20AC stay literal
		// while U+000D becomes \r.
		expect(canonicalizeJcs(input)).toBe(
			'{"\\r":"Carriage Return","1":"One","\u0080":"Control","€":"Euro Sign"}',
		);
	});

	it('escapes control characters but leaves other non-ASCII literal', () => {
		expect(canonicalizeJcs({ a: '\u0000\u001f' })).toBe('{"a":"\\u0000\\u001f"}');
		expect(canonicalizeJcs({ a: 'é€' })).toBe('{"a":"é€"}');
	});

	it('serializes nested structures deterministically regardless of insertion order', () => {
		const a = { outer: { z: [1, { y: 2, x: 3 }], a: true } };
		const b = { outer: { a: true, z: [1, { x: 3, y: 2 }] } };
		expect(canonicalizeJcs(a)).toBe(canonicalizeJcs(b));
		expect(canonicalizeJcs(a)).toBe('{"outer":{"a":true,"z":[1,{"x":3,"y":2}]}}');
	});

	it('omits members whose value is undefined, as JSON.stringify does', () => {
		expect(canonicalizeJcs({ a: 1, b: undefined })).toBe('{"a":1}');
	});

	it('normalises -0 to 0', () => {
		expect(canonicalizeJcs({ a: -0 })).toBe('{"a":0}');
	});

	it('rejects values JSON cannot represent', () => {
		expect(() => canonicalizeJcs({ a: NaN })).toThrow();
		expect(() => canonicalizeJcs({ a: Infinity })).toThrow();
	});

	it('handles null and booleans', () => {
		expect(canonicalizeJcs(null)).toBe('null');
		expect(canonicalizeJcs({ t: true, f: false, n: null })).toBe('{"f":false,"n":null,"t":true}');
	});
});

describe('canonicalizeJcs rejects non-JSON types', () => {
	it('throws for a bigint', () => {
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		expect(() => canonicalizeJcs({ a: 1n })).toThrow(/not serializable/);
	});

	it('throws for a function', () => {
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		expect(() => canonicalizeJcs({ a: () => 1 })).toThrow(/not serializable/);
	});

	it('throws for a symbol', () => {
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		expect(() => canonicalizeJcs(Symbol('s'))).toThrow(/not serializable/);
	});
});
