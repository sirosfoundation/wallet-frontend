import { base64url } from 'jose';
import { cborDecode, cborEncode, DataItem } from '@auth0/mdl/lib/cbor';
import { parse } from '@auth0/mdl';

/**
 * Extract the base64url-encoded IssuerSigned structure from a stored mdoc
 * credential, which may be either a full DeviceResponse envelope or a bare
 * IssuerSigned already.
 *
 * A bare IssuerSigned is returned untouched rather than re-encoded, so the
 * bytes the issuer signed reach the verifier exactly as issued.
 *
 * Decoding here uses mdl's CBOR codec, never cbor-x's defaults. cbor-x
 * decodes maps to plain JavaScript objects, whose keys can only be strings,
 * so a decode/encode round-trip rewrites COSE's integer header labels as
 * decimal strings - issuerAuth's x5chain label 33 becomes "33". Byte strings
 * survive that round-trip untouched, so the corruption is invisible in the
 * credential's payload and signature, and the unprotected header carrying
 * the label is not covered by the COSE signature either. The result reaches
 * a verifier as a correctly-signed credential that appears to carry no
 * certificate chain at all.
 *
 * @param raw - Base64url-encoded DeviceResponse or IssuerSigned
 * @returns Base64url-encoded IssuerSigned
 */
export function extractIssuerSignedB64(raw: string): string {
	const decoded = cborDecode(base64url.decode(raw));
	if (!(decoded instanceof Map)) {
		return raw;
	}

	// Absent `documents` means this is already a bare IssuerSigned. Present
	// but unusable means a malformed DeviceResponse, which must not be passed
	// off as an IssuerSigned - doing so only defers the failure to a parser
	// that can no longer explain it.
	const documents = decoded.get('documents');
	if (documents === undefined) {
		return raw;
	}
	if (!Array.isArray(documents) || documents.length === 0) {
		throw new Error('Malformed DeviceResponse: `documents` is present but empty');
	}

	const first = documents[0];
	const issuerSigned = first instanceof Map ? first.get('issuerSigned') : undefined;
	if (!issuerSigned) {
		throw new Error('Malformed DeviceResponse: first document has no `issuerSigned`');
	}

	return base64url.encode(cborEncode(issuerSigned));
}

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
		documents: [
			new Map([
				['docType', docType],
				['issuerSigned', issuerSigned],
			]),
		],
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
	const fields = disclosedClaims.map((claim) => {
		const lastDot = claim.lastIndexOf('.');
		return {
			path: [`$['${claim.substring(0, lastDot)}']['${claim.substring(lastDot + 1)}']`],
			intent_to_retain: false,
		};
	});

	return {
		id: 'mdoc-request',
		input_descriptors: [
			{
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
			},
		],
	};
}
