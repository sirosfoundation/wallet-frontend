/**
 * OpenID4VP transaction data (OID4VP 1.0 §5.1, §8.4): the entries a verifier
 * asks the user to approve, and the hashes that bind them into the
 * presentation.
 *
 * Each entry arrives as a base64url-encoded JSON object with a `type`, the
 * `credential_ids` (DCQL credential query ids) it applies to, an optional
 * `transaction_data_hashes_alg` list, and type-specific fields. The wallet
 * shows the entries, and every presentation of a listed credential carries
 * the hash of each entry string as received.
 */
import type { OID4VPTransactionData } from '../types/OID4VPTypes';

/** The only hash algorithm the wallet computes; also the default when an entry names none. */
const SUPPORTED_HASH_ALG = 'sha-256';

/** An entry the wallet cannot honour: the verifier is told `invalid_transaction_data`. */
export class UnsupportedTransactionDataError extends Error {
	readonly code = 'UNSUPPORTED_TRANSACTION_DATA';
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedTransactionDataError';
	}
}

function base64urlToText(value: string): string {
	const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function bytesToBase64url(bytes: Uint8Array): string {
	let binary = '';
	bytes.forEach((b) => { binary += String.fromCharCode(b); });
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** One entry, decoded. Throws on anything that is not a base64url JSON object with a type. */
export function decodeTransactionData(raw: string): Record<string, unknown> & { type: string } {
	let entry: unknown;
	try {
		entry = JSON.parse(base64urlToText(raw));
	} catch {
		throw new UnsupportedTransactionDataError('a transaction data entry is not base64url-encoded JSON');
	}
	if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof (entry as { type?: unknown }).type !== 'string') {
		throw new UnsupportedTransactionDataError('a transaction data entry has no type');
	}
	return entry as Record<string, unknown> & { type: string };
}

/** The DCQL credential query ids an entry applies to. */
export function transactionDataCredentialIds(raw: string): string[] {
	const ids = decodeTransactionData(raw).credential_ids;
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** The entries that apply to one credential query. */
export function transactionDataForQuery(entries: string[], credentialQueryId: string): string[] {
	return entries.filter((raw) => transactionDataCredentialIds(raw).includes(credentialQueryId));
}

function readable(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

/**
 * The entries as the consent popup shows them: the type as the heading, the
 * type-specific fields as the text (the protocol fields left out).
 */
export function describeTransactionData(entries: string[]): OID4VPTransactionData[] {
	return entries.map((raw) => {
		const { type, credential_ids: _ids, transaction_data_hashes_alg: _alg, ...fields } = decodeTransactionData(raw);
		const text = Object.entries(fields).map(([k, v]) => `${k}: ${readable(v)}`).join(', ');
		return { type, description: text, data: { heading: type, text } };
	});
}

/**
 * The response parameters binding the entries into one presentation:
 * `transaction_data_hashes`, the base64url SHA-256 of each entry string as
 * received, and `transaction_data_hashes_alg` when the request named the
 * algorithms. An entry that does not allow SHA-256 cannot be honoured.
 */
export async function transactionDataResponseParams(entries: string[]): Promise<{
	transaction_data_hashes: string[];
	transaction_data_hashes_alg?: string;
}> {
	let algNamed = false;
	const hashes = await Promise.all(entries.map(async (raw) => {
		const algs = decodeTransactionData(raw).transaction_data_hashes_alg;
		if (algs !== undefined) {
			if (!Array.isArray(algs) || !algs.includes(SUPPORTED_HASH_ALG)) {
				throw new UnsupportedTransactionDataError(`transaction data hashed with ${readable(algs)} is not supported`);
			}
			algNamed = true;
		}
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
		return bytesToBase64url(new Uint8Array(digest));
	}));
	return {
		transaction_data_hashes: hashes,
		...(algNamed ? { transaction_data_hashes_alg: SUPPORTED_HASH_ALG } : {}),
	};
}