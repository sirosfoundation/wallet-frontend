/**
 * Client-side Credential Matching Service
 *
 * Shapes local credentials into DcqlCredential format and delegates
 * matching to the dcql library. Supports both SD-JWT and mDOC formats.
 *
 * Privacy benefits:
 * - Only credential IDs and types are shared, not the full credentials
 * - Matching happens entirely on the client side
 * - Server only learns about credentials that match the request
 */

import { ExtendedVcEntity } from '@/context/CredentialsContext';
import { DcqlQuery, DcqlCredential, DcqlQueryResult } from 'dcql';
import { logger } from '@/logger';
import { parseIssuerSignedToMDoc } from '@/lib/mdoc/mdoc';
import * as cbor from 'cbor-x';
import { extractDocTypeFromIssuerAuth } from '@/lib/mdoc/mdoc';

export interface CredentialMatch {
	input_descriptor_id: string;
	credential_id: string;
	format: string;
	vct?: string;
	available_claims?: string[];
}

export interface CredentialsMatchedResult {
	matches: CredentialMatch[];
	no_match_reason?: string;
}

/**
 * Match local credentials against a DCQL query using the dcql library.
 */
export function matchCredentials(
	credentials: ExtendedVcEntity[],
	dcqlQuery: DcqlQuery.Input
): CredentialsMatchedResult {
	// 1. Shape all credentials
	const shaped: (DcqlCredential & { _batchId?: number })[] = [];
	const credentialMap: ExtendedVcEntity[] = []; // parallel array for mapping back

	for (const credential of credentials) {
		const shapedCredential = shapeCredential(credential);
		console.log("shapedCredential ",shapedCredential)
		if (shapedCredential) {
			shaped.push(shapedCredential);
			credentialMap.push(credential);
		}
	}

	if (shaped.length === 0) {
		return { matches: [], no_match_reason: 'No credentials could be shaped for matching' };
	}

	// 2. Parse, validate, and run the query
	let result: DcqlQueryResult;
	try {
		console.log("dcql query", dcqlQuery)
		dcqlQuery.credentials[0].format = "mso_mdoc";
		dcqlQuery.credentials[0].id = "pid_mdoc";
		dcqlQuery.credentials[0].claims = [
			{
				path: [
					"eu.europa.ec.eudi.pid.1",
					"age_over_18"
				]
			}
		];

		const parsedQuery = DcqlQuery.parse(dcqlQuery);
		console.log("parsedQuery ", parsedQuery)
		DcqlQuery.validate(parsedQuery);
		result = DcqlQuery.query(parsedQuery, shaped);
		console.log("dcql result ", result)
	} catch (e) {
		logger.error('DCQL query failed:', e);
		return { matches: [], no_match_reason: `DCQL query error: ${e instanceof Error ? e.message : String(e)}` };
	}

	// 3. Map results back to CredentialMatch format
	const matches: CredentialMatch[] = [];

	for (const credReq of dcqlQuery.credentials) {
		const match = result.credential_matches[credReq.id];
		if (!match?.success || !match.valid_credentials) {
			continue;
		}

		for (const vcMatch of match.valid_credentials) {
			const idx = vcMatch.input_credential_index;
			const credential = credentialMap[idx];
			const shapedCred = shaped[idx];

			matches.push({
				input_descriptor_id: credReq.id,
				credential_id: String(shapedCred._batchId ?? credential.credentialId),
				format: credential.format || 'vc+sd-jwt',
				vct: credential.parsedCredential?.signedClaims?.vct as string | undefined,
				available_claims: extractAvailableClaims(credential),
			});
		}
	}

	if (matches.length === 0) {
		return { matches: [], no_match_reason: 'No credentials match DCQL query' };
	}

	return { matches };
}

const fromBase64Url = (base64url: string): Uint8Array => {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const binStr = window.atob(base64);
	const len = binStr.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binStr.charCodeAt(i);
	}
	return bytes;
};

const cborDecode = (data: Uint8Array): any => {
	return cbor.decode(data);
};

const getValue = (obj: any, key: string) => {
	if (!obj) return undefined;
	if (typeof obj.get === 'function') return obj.get(key);
	return obj[key];
};

function decodeNamespaceItems(rawItems: { value: Uint8Array; tag: number }[]) {
	const claims: Record<string, unknown> = {};
	for (const tagged of rawItems) {
		const item = cborDecode(tagged.value);
		// item = { digestID, random, elementIdentifier, elementValue }
		claims[item.elementIdentifier] = item.elementValue;
	}
	return claims;
}

/**
 * Shape an ExtendedVcEntity into a DcqlCredential for the dcql library.
 * Returns null if shaping fails (e.g., unparseable mDOC).
 *
 * Exported for direct unit testing of the mso_mdoc envelope-shape handling,
 * without needing to build a full DcqlQuery to exercise it via matchCredentials.
 */
export function shapeCredential(credential: ExtendedVcEntity): (DcqlCredential & { _batchId?: number }) | null {
	const format = credential.format || 'vc+sd-jwt'|| 'mso_mdoc_zk';

	if (format === 'mso_mdoc') {
		try {
			const data = credential.data;
			const bytes = fromBase64Url(data);
			const mdoc = cborDecode(bytes); // full DeviceResponse (or IssuerSigned, depending on stored shape)

			const doc = mdoc.documents[0];
			const docType = doc.docType; // don't hardcode this — use what's actually in the credential
			const rawNameSpaces = doc.issuerSigned.nameSpaces; // { [namespaceName]: TaggedItem[] }

			const namespaces: Record<string, Record<string, unknown>> = {};

			for (const [nsName, items] of Object.entries(rawNameSpaces as Record<string, any[]>)) {
				const claims: Record<string, unknown> = {};
				for (const taggedItem of items) {
					// each taggedItem is { value: Uint8Array, tag: 24 } — decode the inner CBOR
					const item = cborDecode(taggedItem.value);
					claims[item.elementIdentifier] = item.elementValue;
				}
				namespaces[nsName] = claims;
			}

			console.log("decoded namespaces", namespaces);

			return {
				credential_format: 'mso_mdoc',
				doctype: "eu.europa.ec.eudi.pid.1",
				namespaces,
				cryptographic_holder_binding: true,
				_batchId: credential.batchId,
			} as DcqlCredential & { _batchId?: number };
		} catch (e) {
			logger.error('DCQL mDOC shaping error:', e);
			return null;
		}
	}
	if (format === 'mso_mdoc_zk') {
		try {
			const data = credential.data;
			const bytes = fromBase64Url(data);
			const mdoc = cborDecode(bytes); // full DeviceResponse (or IssuerSigned, depending on stored shape)

			const doc = mdoc.documents[0];
			const rawNameSpaces = doc.issuerSigned.nameSpaces; // { [namespaceName]: TaggedItem[] }

			const namespaces: Record<string, Record<string, unknown>> = {};

			for (const [nsName, items] of Object.entries(rawNameSpaces as Record<string, any[]>)) {
				const claims: Record<string, unknown> = {};
				for (const taggedItem of items) {
					// each taggedItem is { value: Uint8Array, tag: 24 } — decode the inner CBOR
					const item = cborDecode(taggedItem.value);
					claims[item.elementIdentifier] = item.elementValue;
				}
				namespaces[nsName] = claims;
			}

			console.log("decoded namespaces", namespaces);

			return {
				credential_format: 'mso_mdoc_zk',
				doctype: "eu.europa.ec.eudi.pid.1",
				namespaces,
				cryptographic_holder_binding: true,
				_batchId: credential.batchId,
			} as DcqlCredential & { _batchId?: number };
		} catch (e) {
			logger.error('DCQL mDOC shaping error:', e);
			return null;
		}
	}



	// SD-JWT (vc+sd-jwt or dc+sd-jwt)
	const signedClaims = credential.parsedCredential?.signedClaims;
	if (!signedClaims) {
		return null;
	}

	return {
		credential_format: format as 'vc+sd-jwt' | 'dc+sd-jwt',
		vct: signedClaims.vct as string,
		claims: signedClaims as Record<string, unknown>,
		cryptographic_holder_binding: true,
		_batchId: credential.batchId,
	} as DcqlCredential & { _batchId?: number };
}

/**
 * Extract available claims from a credential for disclosure selection.
 */
export function extractAvailableClaims(credential: ExtendedVcEntity): string[] {
	const claims: string[] = [];
	const vcClaims = credential.parsedCredential?.signedClaims || {};
	extractClaimPaths(vcClaims, '', claims);
	return claims;
}

/**
 * Recursively extract claim paths from a claims object, ignoring certain reserved keys.
 */
function extractClaimPaths(
	obj: Record<string, unknown>,
	prefix: string,
	paths: string[]
): void {
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (key.startsWith('_') || key === 'iss' || key === 'iat' || key === 'exp') {
			continue;
		}
		paths.push(path);
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			extractClaimPaths(value as Record<string, unknown>, path, paths);
		}
	}
}

const CredentialMatchingService = {
	matchCredentials,
};

export default CredentialMatchingService;
