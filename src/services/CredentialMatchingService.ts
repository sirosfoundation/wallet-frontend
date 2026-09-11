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
import { cborDecode } from '@auth0/mdl/lib/cbor';
import { fromBase64Url } from "../util";
import { extractDocTypeFromIssuerAuth } from '@/lib/verifiable-credentials';

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
	code?: 'NO_MATCHING_CREDENTIALS' | 'INSUFFICIENT_CREDENTIALS';
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

		if (shapedCredential) {
			shaped.push(shapedCredential);
			credentialMap.push(credential);
		}
	}

	if (shaped.length === 0) {
		return { matches: [], no_match_reason: 'No credentials could be shaped for matching' };
	}

	// TODO: Remove before merge
	logger.debug('matchCredentials: dcqlQuery', JSON.stringify(dcqlQuery));
	// TODO: Remove before merge
	logger.debug('matchCredentials: shaped mdoc', JSON.stringify(
		shaped
		.filter(s => (s as any).credential_format === 'mso_mdoc')
		.map(s => ({ doctype: (s as any).doctype, namespaces: (s as any).namespaces })),
		null, 2));

		// 2. Parse, validate, and run the query
		let result: DcqlQueryResult;
		try {
		const parsedQuery = DcqlQuery.parse(dcqlQuery);
		DcqlQuery.validate(parsedQuery);
		result = DcqlQuery.query(parsedQuery, shaped);
	} catch (e) {
		logger.error('DCQL query failed:', e);
		return { matches: [], no_match_reason: `DCQL query error: ${e instanceof Error ? e.message : String(e)}` };
	}

	// TODO: Remove before merge
	logger.debug('matchCredentials: dcql result', JSON.stringify(result, null, 2));

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

	if (!result.can_be_satisfied) {
		return matches.length > 0
			? { matches: [], code: 'INSUFFICIENT_CREDENTIALS', no_match_reason: 'Not all required credentials are available' }
			: { matches: [], code: 'NO_MATCHING_CREDENTIALS', no_match_reason: 'No credentials match DCQL query' };
	}

	return { matches };
}

/**
 * Shape an ExtendedVcEntity into a DcqlCredential for the dcql library.
 * Returns null if shaping fails (e.g., unparseable mDOC).
 *
 * Exported for direct unit testing of the mso_mdoc envelope-shape handling,
 * without needing to build a full DcqlQuery to exercise it via matchCredentials.
 */
export function shapeCredential(credential: ExtendedVcEntity): (DcqlCredential & { _batchId?: number }) | null {
	const format = credential.format || 'vc+sd-jwt';

	if (format === 'mso_mdoc') {
		try {
			const bytes = fromBase64Url(credential.data);
			// mdl codec, not cbor-x: returns Maps + tag-24 DataItems so
			// IssuerSignedItems expose elementIdentifier/elementValue.
			const mdoc = cborDecode(bytes) as Map<string, unknown>;

			let docType: string;
			let rawNameSpaces: Map<string, unknown[]>;

			const documents = mdoc.get('documents') as unknown[] | undefined;
			if (Array.isArray(documents) && documents.length > 0) {
				const doc = documents[0] as Map<string, unknown>;
				docType = doc.get('docType') as string;
				const issuerSigned = doc.get('issuerSigned') as Map<string, unknown>;
				rawNameSpaces = issuerSigned.get('nameSpaces') as Map<string, unknown[]>;
			} else if (mdoc.get('nameSpaces') && mdoc.get('issuerAuth')) {
				// Bare IssuerSigned; docType comes from the MSO in issuerAuth.
				docType = extractDocTypeFromIssuerAuth(mdoc.get('issuerAuth') as unknown[]);
				rawNameSpaces = mdoc.get('nameSpaces') as Map<string, unknown[]>;
			} else {
				throw new Error('mdoc credential envelope missing documents[] (and not a bare IssuerSigned structure either)');
			}

			const namespaces: Record<string, Record<string, unknown>> = {};
			for (const [nsName, items] of rawNameSpaces) {
				const claims: Record<string, unknown> = {};
				for (const rawItem of items) {
					// mdl decodes each tag-24 item to a DataItem (.data = Map); tolerate
					// a plain Map too. Avoid instanceof DataItem (breaks across mdl copies).
					const item = (rawItem instanceof Map
						? rawItem
						: (rawItem as { data?: Map<string, unknown> })?.data) as Map<string, unknown> | undefined;
					if (!item) continue;
					claims[item.get('elementIdentifier') as string] = item.get('elementValue');
				}
				namespaces[nsName] = claims;
			}

			return {
				credential_format: 'mso_mdoc',
				doctype: docType,
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
