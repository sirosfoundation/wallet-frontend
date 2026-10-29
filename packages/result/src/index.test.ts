import { describe, it, expect } from 'vitest';
import { ok, err } from './index';

describe('ok', () => {
	it('returns correct structure', () => {
		expect(ok(1)).toEqual({ ok: true, value: 1 });
	});
});

describe('err', () => {
	it('returns correct structure', () => {
		expect(err('error')).toEqual({ ok: false, error: 'error' });
	});

	it('fails with empty', () => {
		expect(err('')).toEqual({ ok: false, error: '' });
	});

	it('fails with Error', () => {
		expect(err(new Error('fail'))).toEqual({ ok: false, error: new Error('fail') });
	});
});
