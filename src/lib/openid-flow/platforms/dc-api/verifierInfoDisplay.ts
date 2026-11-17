/**
 * Extract the fronted relying party's display identity from the ETSI TS
 * 119 472-2 §6.3.2.2 `verifier_info` members. An intermediary-signed
 * request carries the registrar dataset (the B.2 members — the fronted
 * RP's `srvDescription`, `purpose`, `policyURI`, and NTR identifier)
 * alongside the registration certificate; the `srvDescription` in the
 * user's language is the display name, with the identifier as the
 * fallback. A verifier-signed request omits the members entirely and the
 * caller falls back to whatever it used before.
 */

/** One `verifier_info` element from the request JWT payload. */
export interface VerifierInfoElement {
	format: string;
	data?: unknown;
}

interface RegistrarDataset {
	srvDescription?: Array<{ lang: string; content: string }>;
	purpose?: Array<{ lang: string; content: string }>;
	policyURI?: string;
	identifier?: Array<{ type: string; identifier: string }>;
}

/**
 * The fronted RP's display identity from the `verifier_info` members, or
 * null when the request carries none (a verifier-signed request, or the
 * members don't have usable display data).
 */
export function frontedRpDisplay(
	members: VerifierInfoElement[] | null | undefined,
	language: string,
): { name: string; purpose?: string; policyURI?: string; identifier?: string } | null {
	if (!members?.length) return null;
	const dataset = members.find((m) => m.format === 'registrar_dataset');
	if (!dataset?.data || typeof dataset.data !== 'object') return null;
	const ds = dataset.data as RegistrarDataset;

	// srvDescription: the member whose lang matches the requested language,
	// then English, then the first entry — the MultiLangString form.
	const localized = <T extends { lang: string }>(entries: T[] | undefined): T | undefined => {
		if (!entries?.length) return undefined;
		const lower = language.toLowerCase();
		return entries.find((e) => e.lang.toLowerCase().startsWith(lower.split('-')[0]))
			?? entries.find((e) => e.lang.toLowerCase().startsWith('en'))
			?? entries[0];
	};

	const description = localized(ds.srvDescription);
	const purpose = localized(ds.purpose);
	const identifier = ds.identifier?.[0]?.identifier;

	// The display name: srvDescription first, then the NTR identifier.
	const name = description?.content ?? identifier;
	if (!name) return null;

	return {
		name,
		purpose: purpose?.content,
		policyURI: ds.policyURI,
		identifier,
	};
}
