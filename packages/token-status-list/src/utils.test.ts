import { describe, it, expect } from 'vitest';
import { base64url } from 'jose';
import { TokenStatus } from './resources';
import {
	decompressStatusListToArray,
	deriveTokenBatchStatus,
	readTokenStatusFromArray,
	resolveTokenStatus,
} from './utils';

describe('readTokenStatusFromArray', () => {
	it('reads 1-bit entries least significant bit first', () => {
		// 1-bit example from the IETF Token Status List draft.
		const list = new Uint8Array([0xb9, 0xa3]);
		const expected = [1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1];

		expected.forEach((status, idx) => {
			expect(readTokenStatusFromArray(list, 1, idx)).toBe(status);
		});
	});

	it('reads 2-bit entries', () => {
		// 2-bit example from the IETF Token Status List draft.
		const list = new Uint8Array([0xc9, 0x44, 0xf9]);
		const expected = [1, 2, 0, 3, 0, 1, 0, 1, 1, 2, 3, 3];

		expected.forEach((status, idx) => {
			expect(readTokenStatusFromArray(list, 2, idx)).toBe(status);
		});
	});

	it('reads 4-bit entries', () => {
		const list = new Uint8Array([0xa3]);

		expect(readTokenStatusFromArray(list, 4, 0)).toBe(0x3);
		expect(readTokenStatusFromArray(list, 4, 1)).toBe(0xa);
	});

	it('reads 8-bit entries', () => {
		const list = new Uint8Array([0, 7, 255]);

		expect(readTokenStatusFromArray(list, 8, 1)).toBe(7);
		expect(readTokenStatusFromArray(list, 8, 2)).toBe(255);
	});

	it('throws out_of_range past the end of the list', () => {
		const list = new Uint8Array([0xff, 0xff]);

		expect(() => readTokenStatusFromArray(list, 1, 16)).toThrow(
			expect.objectContaining({ kind: 'out_of_range' }),
		);
	});
});

describe('decompressStatusListToArray', () => {
	it('decodes and inflates a base64url zlib list', async () => {
		const bytes = new Uint8Array([0xb9, 0xa3, 0x00, 0xff]);

		expect(await decompressStatusListToArray(await compress(bytes))).toEqual(
			bytes,
		);
	});

	it('throws malformed on invalid input', async () => {
		await expect(decompressStatusListToArray('not-zlib')).rejects.toMatchObject(
			{
				kind: 'malformed',
			},
		);
	});
});

describe('resolveTokenStatus', () => {
	it('maps spec values', () => {
		expect(resolveTokenStatus(0)).toBe(TokenStatus.VALID);
		expect(resolveTokenStatus(1)).toBe(TokenStatus.INVALID);
		expect(resolveTokenStatus(2)).toBe(TokenStatus.SUSPENDED);
	});

	it('rejects reserved values', () => {
		expect(resolveTokenStatus(0x04)).toBe(TokenStatus.REJECTED);
		expect(resolveTokenStatus(0x0b)).toBe(TokenStatus.REJECTED);
	});

	it('treats application-specific and other values as unknown', () => {
		expect(resolveTokenStatus(0x03)).toBe(TokenStatus.UNKNOWN);
		expect(resolveTokenStatus(0x0c)).toBe(TokenStatus.UNKNOWN);
		expect(resolveTokenStatus(255)).toBe(TokenStatus.UNKNOWN);
	});
});

describe('deriveTokenBatchStatus', () => {
	const unused = (status?: TokenStatus) => ({ status, spent: false });
	const spent = (status?: TokenStatus) => ({ status, spent: true });

	it('is valid when an unused instance is valid', () => {
		expect(
			deriveTokenBatchStatus([
				unused(TokenStatus.INVALID),
				unused(TokenStatus.VALID),
			]),
		).toBe(TokenStatus.VALID);
	});

	it('ignores spent instances while unused ones remain', () => {
		expect(
			deriveTokenBatchStatus([
				spent(TokenStatus.INVALID),
				unused(TokenStatus.VALID),
			]),
		).toBe(TokenStatus.VALID);
	});

	it('is blocked when every unused instance is blocked', () => {
		expect(
			deriveTokenBatchStatus([
				spent(TokenStatus.VALID),
				unused(TokenStatus.INVALID),
			]),
		).toBe(TokenStatus.INVALID);
	});

	it('reports the worst blocked status', () => {
		expect(
			deriveTokenBatchStatus([
				unused(TokenStatus.SUSPENDED),
				unused(TokenStatus.INVALID),
			]),
		).toBe(TokenStatus.INVALID);
		expect(
			deriveTokenBatchStatus([
				unused(TokenStatus.SUSPENDED),
				unused(TokenStatus.REJECTED),
			]),
		).toBe(TokenStatus.REJECTED);
	});

	it('reports the best usable status', () => {
		expect(
			deriveTokenBatchStatus([
				unused(TokenStatus.UNKNOWN),
				unused(TokenStatus.PENDING),
			]),
		).toBe(TokenStatus.PENDING);
	});

	it('looks at every instance once all are spent', () => {
		expect(
			deriveTokenBatchStatus([
				spent(TokenStatus.INVALID),
				spent(TokenStatus.INVALID),
			]),
		).toBe(TokenStatus.INVALID);
		expect(
			deriveTokenBatchStatus([
				spent(TokenStatus.INVALID),
				spent(TokenStatus.VALID),
			]),
		).toBe(TokenStatus.VALID);
	});

	it('is undefined when no instance has a status yet', () => {
		expect(deriveTokenBatchStatus([unused(), unused()])).toBeUndefined();
		expect(deriveTokenBatchStatus([])).toBeUndefined();
	});
});

async function compress(bytes: Uint8Array): Promise<string> {
	const stream = new Blob([new Uint8Array(bytes)])
		.stream()
		.pipeThrough(new CompressionStream('deflate'));
	return base64url.encode(
		new Uint8Array(await new Response(stream).arrayBuffer()),
	);
}
