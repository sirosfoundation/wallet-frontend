import { describe, expect, it } from 'vitest';
import { publicProgressPayload } from './progressRedaction';

describe('publicProgressPayload', () => {
	it('drops the PKCE verifier, the state and tokens', () => {
		const out = publicProgressPayload({
			authorization_url: 'https://issuer.example/authorize',
			code_verifier: 'v',
			state: 's',
			access_token: 'a',
			'pre-authorized_code': 'p',
		});
		expect(out).toEqual({ authorization_url: 'https://issuer.example/authorize' });
	});

	it('drops secrets inside nested objects and arrays', () => {
		const out = publicProgressPayload({
			credential_offer: { grants: { code: 'x', issuer: 'i' } },
			items: [{ refresh_token: 'r', name: 'n' }],
		});
		expect(out).toEqual({ credential_offer: { grants: { issuer: 'i' } }, items: [{ name: 'n' }] });
	});

	it('leaves the input untouched', () => {
		const input = { code_verifier: 'v', step: 'x' };
		publicProgressPayload(input);
		expect(input).toEqual({ code_verifier: 'v', step: 'x' });
	});
});
