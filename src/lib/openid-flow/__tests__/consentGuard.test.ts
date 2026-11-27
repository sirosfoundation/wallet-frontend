import { describe, it, expect } from 'vitest';
import { verifySignRequestAgainstConsent, type ConsentedCredential } from '../consentGuard';

const consent: ConsentedCredential[] = [
	{ credentialId: 'c1', credentialQueryId: 'q1', disclosedClaims: ['a', 'b'], credentialRaw: 'raw1' },
	{ credentialId: 'c2', credentialQueryId: 'q2', disclosedClaims: ['x'], credentialRaw: 'raw2' },
];
const entry = (id: string, q: string, claims: unknown) => ({ credential_id: id, credential_query_id: q, disclosed_claims: claims });

describe('verifySignRequestAgainstConsent', () => {
	it('accepts an exact match and builds from the stored consent', () => {
		const r = verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['a', 'b']), entry('c2', 'q2', ['x'])]);
		expect(r).toEqual({
			ok: true,
			credentials: [
				{ credentialId: 'c1', credentialQueryId: 'q1', disclosedClaims: ['a', 'b'], credentialRaw: 'raw1' },
				{ credentialId: 'c2', credentialQueryId: 'q2', disclosedClaims: ['x'], credentialRaw: 'raw2' },
			],
		});
	});

	it('accepts reordered credentials and claims', () => {
		const r = verifySignRequestAgainstConsent(consent, [entry('c2', 'q2', ['x']), entry('c1', 'q1', ['b', 'a'])]);
		expect(r.ok).toBe(true);
	});

	it('honours a subset without widening it', () => {
		const r = verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['a']), entry('c2', 'q2', ['x'])]);
		if (r.ok === true) expect(r.credentials[0].disclosedClaims).toEqual(['a']); else throw new Error('refused');
	});

	it('treats omitted disclosed_claims (engine omitempty) as no claims, not as all', () => {
		const withEmpty: ConsentedCredential[] = [{ credentialId: 'c1', credentialQueryId: 'q1', disclosedClaims: [], credentialRaw: 'raw1' }];
		const r = verifySignRequestAgainstConsent(withEmpty, [{ credential_id: 'c1', credential_query_id: 'q1' }]);
		expect(r.ok).toBe(true);
		const widened = verifySignRequestAgainstConsent(consent, [{ credential_id: 'c1', credential_query_id: 'q1' }, entry('c2', 'q2', ['x'])]);
		if (widened.ok === true) expect(widened.credentials[0].disclosedClaims).toEqual([]);
		else throw new Error('refused');
	});

	it('refuses an extra claim', () => {
		expect(verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['a', 'z']), entry('c2', 'q2', ['x'])]).ok).toBe(false);
	});

	it('refuses an extra credential', () => {
		expect(verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['a']), entry('c2', 'q2', ['x']), entry('c3', 'q3', [])]).ok).toBe(false);
	});

	it('refuses a missing credential', () => {
		expect(verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['a'])]).ok).toBe(false);
	});

	it('refuses a duplicated credential entry', () => {
		const one = [consent[0]];
		expect(verifySignRequestAgainstConsent(one, [entry('c1', 'q1', ['a']), entry('c1', 'q1', ['b'])]).ok).toBe(false);
	});

	it('refuses a credential id swapped under a consented query id', () => {
		expect(verifySignRequestAgainstConsent(consent, [entry('c2', 'q1', ['a']), entry('c1', 'q2', ['x'])]).ok).toBe(false);
	});

	it.each([
		['not an array', 'nope'],
		['empty', []],
		['null entry', [null]],
		['array entry', [[]]],
		['missing credential_id', [{ credential_query_id: 'q1', disclosed_claims: [] }]],
		['missing query id', [{ credential_id: 'c1', disclosed_claims: [] }]],
		['null disclosed_claims', [{ credential_id: 'c1', credential_query_id: 'q1', disclosed_claims: null }]],
		['non-string claim', [entry('c1', 'q1', ['a', 1])]],
		['claims not an array', [entry('c1', 'q1', 'a')]],
	])('refuses malformed: %s', (_name, requested) => {
		expect(verifySignRequestAgainstConsent(consent, requested).ok).toBe(false);
	});

	it('refuses when no consent is recorded', () => {
		expect(verifySignRequestAgainstConsent(undefined, [entry('c1', 'q1', ['a'])]).ok).toBe(false);
		expect(verifySignRequestAgainstConsent([], [entry('c1', 'q1', ['a'])]).ok).toBe(false);
	});

	it('never puts claim names in the reason', () => {
		const r = verifySignRequestAgainstConsent(consent, [entry('c1', 'q1', ['secret_claim']), entry('c2', 'q2', ['x'])]);
		expect(r.ok).toBe(false);
		if (r.ok === false) expect(r.reason).not.toContain('secret_claim');
	});
});
