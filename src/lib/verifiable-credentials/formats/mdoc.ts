import { base64url } from 'jose';
import { cborDecode, cborEncode, DataItem } from '@auth0/mdl/lib/cbor';
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
	const issuerSigned = cborDecode(credentialBytes);
	const issuerAuth = issuerSigned.get('issuerAuth') as Array<Uint8Array>;
	const payload = issuerAuth?.[2];
	const docType = cborDecode(payload).data.get('docType');
	const envelope = {
		version: '1.0',
		documents: [new Map([['docType', docType], ['issuerSigned', issuerSigned]])],
		status: 0,
	};
	return parse(cborEncode(envelope));
}

/**
 * Extract `docType` from the MSO (MobileSecurityObject) embedded in a bare
 * `IssuerSigned` structure's `issuerAuth` COSE_Sign1 payload (index 2 of the
 * 4-element array) - the only place docType is available when there's no
 * enclosing `{docType, issuerSigned}` document wrapper (e.g. a stored mdoc
 * credential issued directly as a bare IssuerSigned, as real-world/interop
 * issuers such as geneva2026.mdoc.online do for `mso_mdoc` credential
 * responses).
 *
 * @param issuerAuth - The decoded COSE_Sign1 array `[protected, unprotected, payload, signature]`
 * @returns The MSO's `docType`
 */
export function extractDocTypeFromIssuerAuth(issuerAuth: unknown[]): string {
	const payload = issuerAuth?.[2] as Uint8Array | undefined;
	if (!payload) {
		throw new Error('issuerAuth is not a COSE_Sign1 array (missing payload)');
	}
	const decoded = cborDecode(payload);
	const mso = decoded instanceof DataItem ? decoded.data : decoded;
	const docType = mso?.get?.('docType');
	if (!docType) {
		throw new Error('MSO missing docType');
	}
	return docType;
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
