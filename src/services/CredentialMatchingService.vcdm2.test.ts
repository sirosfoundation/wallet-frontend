import { describe, expect, it } from 'vitest';
import { matchCredentials, shapeCredential } from './CredentialMatchingService';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';

const VCDM2_CONTEXT = 'https://www.w3.org/ns/credentials/v2';

/**
 * A W3C VCDM 2.0 credential carried in an SD-JWT, as the eduwallet issuers
 * emit it: no `vct`, identified by its `type` array, and stored under the
 * `vc+sd-jwt` format the issuer advertised — the same identifier legacy
 * SD-JWT VC uses.
 */
const vcdm2Claims = {
	'@context': [VCDM2_CONTEXT],
	type: ['VerifiableCredential', 'AcademicEnrollmentCredential'],
	issuer: { id: 'did:web:mbob.issuer.dev.eduwallet.nl', name: 'MBO Beek' },
	credentialSubject: { institutionBRINCode: 'AK0092' },
	validFrom: '2026-09-08T12:31:02Z',
};

function entity(format: string, signedClaims: Record<string, unknown>): ExtendedVcEntity {
	return {
		credentialId: 1,
		batchId: 7,
		format,
		data: 'unused-for-shaping',
		parsedCredential: { signedClaims },
	} as unknown as ExtendedVcEntity;
}

describe('shapeCredential — W3C VCDM 2.0', () => {
	it('shapes it by type, with no vct', () => {
		const shaped = shapeCredential(entity('vc+sd-jwt', vcdm2Claims)) as Record<string, unknown>;

		expect(shaped.credential_format).toBe('vc+sd-jwt');
		expect(shaped.type).toEqual(['VerifiableCredential', 'AcademicEnrollmentCredential']);
		// An undefined vct is what made this match nothing.
		expect(shaped.vct).toBeUndefined();
	});

	it('maps the internal discriminator back to the wire format', () => {
		const shaped = shapeCredential(entity('vcdm2+sd-jwt', vcdm2Claims)) as Record<string, unknown>;
		expect(shaped.credential_format).toBe('vc+sd-jwt');
	});

	it('leaves a genuine SD-JWT VC on its vct-based shaping', () => {
		const shaped = shapeCredential(
			entity('dc+sd-jwt', { vct: 'urn:eduid', iss: 'https://epi.example' })
		) as Record<string, unknown>;

		expect(shaped.vct).toBe('urn:eduid');
		expect(shaped.type).toBeUndefined();
	});
});

describe('matchCredentials — W3C VCDM 2.0', () => {
	// What a verifier asking for this credential sends.
	const query = {
		credentials: [{
			id: 'enrollment',
			format: 'vc+sd-jwt',
			meta: { type_values: [['AcademicEnrollmentCredential']] },
		}],
	} as never;

	it('matches a VCDM 2.0 credential stored under the shared wire format', () => {
		const { matches, no_match_reason } = matchCredentials(
			[entity('vc+sd-jwt', vcdm2Claims)],
			query
		);

		expect(no_match_reason).toBeUndefined();
		expect(matches).toHaveLength(1);
		expect(matches[0].input_descriptor_id).toBe('enrollment');
		expect(matches[0].credential_id).toBe('7');
	});

	it('does not match a credential of the wrong type', () => {
		const other = { ...vcdm2Claims, type: ['VerifiableCredential', 'SomethingElse'] };
		expect(matchCredentials([entity('vc+sd-jwt', other)], query).matches).toHaveLength(0);
	});
});
