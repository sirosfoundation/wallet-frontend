/**
 * Interim defence: a sign_presentation request from the engine must match what
 * the user consented to.
 *
 * The engine echoes `credentials_to_include` (credential_id, credential_query_id,
 * disclosed_claims) from the consent the wallet sent it. A modified engine could
 * return more claims or more credentials than the user agreed to. The wallet
 * therefore records the consent locally and verifies every sign request against
 * it before anything is disclosed or signed.
 *
 * Rules (strict, fail closed):
 *  - the (credential_query_id, credential_id) set must equal the consented set
 *    (no extra, no missing, no duplicates);
 *  - disclosed claims per credential must be a subset of the consented claims
 *    (order is irrelevant); a subset is honoured as a subset and never widened;
 *  - every entry must be well formed.
 *
 * Reasons never include claim values; claim names are not echoed either.
 *
 * After the wire redesign (credentials_to_include becomes
 * [{credential_query_id}] + selection_handle) this check becomes "the
 * selection_handle must map to a selection recorded at consent time".
 */

export interface ConsentedCredential {
	credentialId: string;
	credentialQueryId: string;
	disclosedClaims: string[];
	credentialRaw: string;
}

export interface VerifiedCredentialToInclude {
	credentialId: string;
	credentialQueryId: string;
	disclosedClaims: string[];
	credentialRaw: string;
}

export type ConsentVerification =
	| { ok: true; credentials: VerifiedCredentialToInclude[] }
	| { ok: false; reason: string };

const fail = (reason: string): ConsentVerification => ({ ok: false, reason });

const entryKey = (queryId: string, credentialId: string) => JSON.stringify([queryId, credentialId]);

/**
 * @param consent   what the user consented to for this flow (undefined = none recorded)
 * @param requested the raw `credentials_to_include` from the engine (untrusted)
 */
export function verifySignRequestAgainstConsent(
	consent: readonly ConsentedCredential[] | undefined,
	requested: unknown,
): ConsentVerification {
	if (!consent || consent.length === 0) {
		return fail('no consent recorded for this flow');
	}
	if (!Array.isArray(requested) || requested.length === 0) {
		return fail('sign request has no credentials_to_include');
	}

	const consentByKey = new Map<string, ConsentedCredential>();
	for (const c of consent) {
		consentByKey.set(entryKey(c.credentialQueryId, c.credentialId), c);
	}

	const seen = new Set<string>();
	const verified: VerifiedCredentialToInclude[] = [];

	for (const entry of requested as unknown[]) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			return fail('malformed credentials_to_include entry');
		}
		const e = entry as Record<string, unknown>;
		if (typeof e.credential_id !== 'string' || e.credential_id === '') {
			return fail('malformed credentials_to_include entry: credential_id');
		}
		if (typeof e.credential_query_id !== 'string' || e.credential_query_id === '') {
			return fail('malformed credentials_to_include entry: credential_query_id');
		}
		// The engine omits an empty disclosed_claims (omitempty): absent means no
		// claims, which is a subset and never widens. Anything else must be a string array.
		const requestedClaims = e.disclosed_claims === undefined ? [] : e.disclosed_claims;
		if (!Array.isArray(requestedClaims) || !requestedClaims.every(x => typeof x === 'string')) {
			return fail('malformed credentials_to_include entry: disclosed_claims');
		}

		const key = entryKey(e.credential_query_id, e.credential_id);
		const consented = consentByKey.get(key);
		if (!consented) {
			return fail('sign request includes a credential that was not consented to');
		}
		if (seen.has(key)) {
			return fail('sign request includes the same credential more than once');
		}
		seen.add(key);

		const allowed = new Set(consented.disclosedClaims);
		const claims = Array.from(new Set(requestedClaims as string[]));
		if (!claims.every(claim => allowed.has(claim))) {
			return fail('sign request discloses claims that were not consented to');
		}

		// Built from the locally stored consent (credential material and ids),
		// never from the engine's entry. Claims are the verified subset.
		verified.push({
			credentialId: consented.credentialId,
			credentialQueryId: consented.credentialQueryId,
			disclosedClaims: claims,
			credentialRaw: consented.credentialRaw,
		});
	}

	if (seen.size !== consentByKey.size) {
		return fail('sign request is missing a consented credential');
	}

	return { ok: true, credentials: verified };
}
