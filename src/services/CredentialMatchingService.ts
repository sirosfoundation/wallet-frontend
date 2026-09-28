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
import { isVcdm2Credential, toTypeArray } from 'wallet-common';
import { cborDecode } from '@auth0/mdl/lib/cbor';
import { fromBase64Url } from "../util";
import { decodeStoredMdoc, extractDocTypeFromIssuerAuth, mdocNameSpacesToClaims, resolveMdocIssuerSigned } from '@/lib/verifiable-credentials';

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

	// Shaping and matching fail silently otherwise: the caller only sees a
	// generic selection error, with nothing saying which credential was
	// rejected or why. These make a failed match self-explanatory in the
	// console without having to reproduce it against a local build.
	logger.debug('DCQL query requested:', JSON.stringify(dcqlQuery));
	logger.debug('DCQL shaped credentials:', shaped.map((c) => {
		const r = c as Record<string, unknown>;
		return {
			credential_format: r.credential_format,
			vct: r.vct,
			type: r.type,
			doctype: r.doctype,
			batchId: r._batchId,
		};
	}));

	if (shaped.length === 0) {
		logger.error('DCQL: no credentials could be shaped', {
			held: credentials.length,
			formats: credentials.map((c) => c.format),
			parsed: credentials.map((c) => Boolean(c.parsedCredential?.signedClaims)),
		});
		return { matches: [], no_match_reason: 'No credentials could be shaped for matching' };
	}

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

	// 3. Map results back to CredentialMatch format
	const matches: CredentialMatch[] = [];

	for (const credReq of dcqlQuery.credentials) {
		const match = result.credential_matches[credReq.id];
		if (!match?.success || !match.valid_credentials) {
			// Why a query id matched nothing is the single most useful thing
			// to know here, and dcql reports it per rejected credential.
			logger.error('DCQL: no credential satisfied query', {
				queryId: credReq.id,
				requestedFormat: (credReq as Record<string, unknown>).format,
				requestedMeta: (credReq as Record<string, unknown>).meta,
				issues: (match as Record<string, any> | undefined)?.failed_credentials?.map((f: any) => ({
					meta: f?.meta?.issues,
					claims: f?.claims?.issues,
				})),
			});
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
			const mdoc = decodeStoredMdoc(credential.data);
			const { docType, nameSpaces } = resolveMdocIssuerSigned(mdoc);

			return {
				credential_format: 'mso_mdoc',
				doctype: docType,
				namespaces: mdocNameSpacesToClaims(nameSpaces),
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

	// A W3C VCDM 2.0 credential carried in an SD-JWT is a different DCQL model
	// from an SD-JWT VC: it is identified by its `type` array and has no `vct`
	// at all, so shaping one the SD-JWT VC way produces an undefined `vct` that
	// matches nothing.
	//
	// The stored format cannot tell the two apart — the wallet records what the
	// issuer advertised, and both advertise `vc+sd-jwt` — so the payload
	// decides. `vcdm2+sd-jwt` is internal and never a wire value, so it is
	// mapped back to the identifier a verifier actually asks for.
	if (isVcdm2Credential(signedClaims)) {
		return {
			credential_format: format === 'vcdm2+sd-jwt' ? 'vc+sd-jwt' : format,
			type: toTypeArray((signedClaims as Record<string, unknown>).type),
			claims: signedClaims as Record<string, unknown>,
			cryptographic_holder_binding: true,
			_batchId: credential.batchId,
		} as DcqlCredential & { _batchId?: number };
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
