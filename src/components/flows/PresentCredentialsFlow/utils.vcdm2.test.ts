import { describe, expect, it } from 'vitest';
import { resolveCredentialPresentationRequest } from './utils';
import type { ConformantCredentials } from '@/lib/openid-flow/types/OID4VPTypes';
import type { OID4VPVerifierInfo } from '@/lib/openid-flow/types/OID4VPTypes';

const verifierInfo = {
	name: 'sandbox',
	domain: 'verifier.dev.eduwallet.nl',
	purpose: 'Proeftuin requires the credential content',
} as OID4VPVerifierInfo;

const conformant: ConformantCredentials = new Map([
	['eduID', {
		credentials: [7],
		requestedFields: [{ name: 'email', path: ['email'] }],
	}],
]);

describe('resolveCredentialPresentationRequest without a DCQL query', () => {
	/**
	 * The http_proxy flow matches in wallet-common and returns only the
	 * conformant map -- no dcqlQuery. Dereferencing it here threw
	 * "Cannot read properties of undefined (reading 'credentials')", which
	 * surfaced to the user as a credential selection error.
	 */
	it('falls back to the conformant map for the query ids', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			undefined,
			conformant,
			[],
			['en'],
		);

		expect(request.queries).toHaveLength(1);
		expect(request.queries[0].id).toBe('eduID');
		// No credentials were supplied, so there is nothing to match against;
		// the point is that the query id was recovered at all.
		expect(request.queries[0].matches).toEqual([]);
	});

	it('still produces a default credential set', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			undefined,
			conformant,
			[],
			['en'],
		);

		expect(request.sets).toEqual([{ required: true, options: [['eduID']] }]);
	});

	it('prefers the query when one is supplied', async () => {
		const request = await resolveCredentialPresentationRequest(
			verifierInfo,
			{
				credentials: [{ id: 'eduID', format: 'dc+sd-jwt' }],
				credential_sets: [{ options: [['eduID']], purpose: 'Proeftuin requires the credential content' }],
			} as never,
			conformant,
			[],
			['en'],
		);

		expect(request.queries[0].id).toBe('eduID');
		expect(request.sets[0].purpose).toBe('Proeftuin requires the credential content');
	});
});
