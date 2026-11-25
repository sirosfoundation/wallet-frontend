/**
 * Progress events go to every listener the app registers, and listeners log
 * them. The engine's step payloads can carry the PKCE verifier, the state and
 * tokens, which must stay inside the transport that needs them.
 */
const SECRET_KEYS = new Set([
	'code_verifier',
	'state',
	'code',
	'auth_code',
	'access_token',
	'refresh_token',
	'id_token',
	'pre-authorized_code',
	'tx_code',
	'c_nonce',
	'dpop_nonce',
	'resumption_token',
]);

/** A copy of a progress payload without secret members, at any depth. */
export function publicProgressPayload(payload: Record<string, unknown>): Record<string, unknown> {
	return redact(payload) as Record<string, unknown>;
}

function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redact);
	if (value === null || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
		if (SECRET_KEYS.has(key)) continue;
		out[key] = redact(member);
	}
	return out;
}
