import { describe, expect, it } from 'vitest';
import { extractStatusListReference } from './statusListReference';
import { cborToPlain } from '../credential-parsers/MsoMdocParser';

const URI = 'https://issuer.example.com/statuslists/1';

describe('extractStatusListReference', () => {
	it('reads uri and idx from status.status_list', () => {
		expect(extractStatusListReference({ status_list: { uri: URI, idx: 42 } }))
			.toEqual({ uri: URI, idx: 42 });
	});

	it('ignores other members', () => {
		expect(extractStatusListReference({ status_list: { uri: URI, idx: 0, extra: true }, other: {} }))
			.toEqual({ uri: URI, idx: 0 });
	});

	it.each([
		['no status', undefined],
		['a non-object status', 'revoked'],
		['no status_list', { other: {} }],
		['a non-object status_list', { status_list: URI }],
		['a non-string uri', { status_list: { uri: 1, idx: 0 } }],
		['a missing uri', { status_list: { idx: 0 } }],
		['a non-number idx', { status_list: { uri: URI, idx: '0' } }],
		['a negative idx', { status_list: { uri: URI, idx: -1 } }],
		['a fractional idx', { status_list: { uri: URI, idx: 1.5 } }],
		['an unsafe idx', { status_list: { uri: URI, idx: Number.MAX_SAFE_INTEGER + 1 } }],
	])('returns undefined for %s', (_, status) => {
		expect(extractStatusListReference(status)).toBeUndefined();
	});

	it('reads a reference from an mdoc MSO, where it is a CBOR Map', () => {
		const msoStatus = new Map([['status_list', new Map<string, unknown>([['idx', 7], ['uri', URI]])]]);

		expect(extractStatusListReference(cborToPlain(msoStatus))).toEqual({ uri: URI, idx: 7 });
	});
});
