import { base64url } from 'jose';
import { cborDecode, cborEncode } from '@auth0/mdl/lib/cbor';
import { parse } from '@auth0/mdl';

/**
 * Parse a base64url-encoded issuerSigned blob into an MDoc
 * @todo This partially exists in wallet-common, we should look into consolidating this logic.
 *
 * @param raw - Base64url-encoded issuerSigned blob from an OID4VCI proof or similar
 * @returns Parsed MDoc object with version, documents array, and status
 */
export function parseIssuerSignedToMDoc(raw: string) {
	const credentialBytes = base64url.decode(raw);
	const deviceResponse = cborDecode(credentialBytes);
	const parsed =  parse(cborEncode(deviceResponse));
	return parsed;
}

/**
 * Build a PEX presentation definition from disclosed claim URN paths
 * @todo This partially exists in wallet-common, we should look into consolidating this logic.
 *
 * @param docType - The docType of the MDoc being requested (e.g. "org.iso.18013.5.1.mDL")
 * @param disclosedClaims - Array of claim paths to disclose, e.g. ["credentialSubject.name", "credentialSubject.address.street"]
 * @returns Presentation definition object for requesting an MDoc presentation with the specified claims disclosed
 */
export function buildMdocPresentationDefinition(docType: string, disclosedClaims: string[]) {
	const fields = disclosedClaims.map(claim => {
		const lastDot = claim.lastIndexOf('.');
		return {
			path: [`$['${claim.substring(0, lastDot)}']['${claim.substring(lastDot + 1)}']`],
			intent_to_retain: false,
		};
	});

	return {
		id: 'mdoc-request',
		input_descriptors: [{
			id: docType,
			format: {
				mso_mdoc: {
					alg: ['ES256', 'ES384', 'EdDSA'],
				},
			},
			constraints: {
				limit_disclosure: 'required',
				fields,
			},
		}],
	};
}
