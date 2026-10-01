import { describe, expect, it } from "vitest";
import * as cbor from "cbor-x";
import { matchCredentials, shapeCredential } from "./CredentialMatchingService";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { toBase64Url } from '@/lib/utils';

/**
 * `shapeCredential` (mso_mdoc branch) must handle both stored-credential
 * shapes seen in practice:
 * - a full DeviceResponse-shaped envelope (`{documents: [{docType,
 *   issuerSigned}], ...}`) - our own vc-issuer's convention.
 * - a bare IssuerSigned structure (`{nameSpaces, issuerAuth}`) directly, with
 *   docType read from the MSO embedded in issuerAuth instead of a docType
 *   field (IssuerSigned has none) - what real-world/interop issuers (e.g.
 *   geneva2026.mdoc.online) send for mso_mdoc credential responses.
 */

function buildIssuerAuth(docType: string): unknown[] {
	const msoBytes = cbor.encode({ docType });
	const taggedMsoBytes = cbor.encode(new cbor.Tag(msoBytes, 24));
	return [new Uint8Array(0), {}, taggedMsoBytes, new Uint8Array(64)];
}

function buildItem(elementIdentifier: string, elementValue: string) {
	const itemBytes = cbor.encode({
		digestID: 0,
		random: new Uint8Array(16),
		elementIdentifier,
		elementValue,
	});
	return new cbor.Tag(itemBytes, 24);
}

function buildNameSpaces(namespace: string) {
	return {
		[namespace]: [buildItem("given_name", "Jane"), buildItem("family_name", "Doe")],
	};
}

function mockMdocCredential(bytes: Uint8Array): ExtendedVcEntity {
	return {
		format: "mso_mdoc",
		data: toBase64Url(bytes),
		batchId: 1,
	} as unknown as ExtendedVcEntity;
}

describe("shapeCredential (mso_mdoc)", () => {
	it("shapes a full DeviceResponse-shaped envelope", () => {
		const docType = "org.iso.18013.5.1.mDL";
		const namespace = "org.iso.18013.5.1";
		const envelope = {
			documents: [{
				docType,
				issuerSigned: { nameSpaces: buildNameSpaces(namespace), issuerAuth: buildIssuerAuth(docType) },
			}],
			status: 0,
		};

		const shaped = shapeCredential(mockMdocCredential(cbor.encode(envelope)));

		expect(shaped).not.toBeNull();
		expect((shaped as any).doctype).toBe(docType);
		expect((shaped as any).namespaces[namespace].given_name).toBe("Jane");
	});

	it("shapes a bare IssuerSigned structure, deriving docType from the MSO", () => {
		const docType = "eu.europa.ec.eudi.pid.1";
		const namespace = "eu.europa.ec.eudi.pid.1";
		const bareIssuerSigned = {
			nameSpaces: buildNameSpaces(namespace),
			issuerAuth: buildIssuerAuth(docType),
		};

		const shaped = shapeCredential(mockMdocCredential(cbor.encode(bareIssuerSigned)));

		expect(shaped).not.toBeNull();
		expect((shaped as any).doctype).toBe(docType);
		expect((shaped as any).namespaces[namespace].family_name).toBe("Doe");
	});

	it("returns null (not throws) for an unparseable mdoc", () => {
		const garbage = cbor.encode({ somethingElse: "value" });
		expect(shapeCredential(mockMdocCredential(garbage))).toBeNull();
	});
});

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
