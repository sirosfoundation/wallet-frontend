import { Encoder, Tag } from 'cbor-x';
import type { ZkpPresentation } from './types';

const cbor = new Encoder({ useRecords: false, tagUint8Array: false });

/**
 * The OpenID4VP `vp_token`: one presentation per query id,
 * each base64url (unpadded) of the CBOR `ZkpPresentation` defined by the nym_auth rulebook.
 */
export function encodeZkpReqVpToken(presentations: Map<string, ZkpPresentation>): string {
	return JSON.stringify(
		Object.fromEntries(
			[...presentations].map(([queryId, presentation]) => [
				queryId,
				[base64url(encodePresentation(presentation))],
			]),
		),
	);
}

/**
 * Only the rulebook's members; `proof_system` is not part of it.
 */
function encodePresentation(presentation: ZkpPresentation): Uint8Array {
	const { system_id, proof, issuer_key_set, proof_time, results } = presentation;

	return cbor.encode({
		system_id,
		proof,
		...(issuer_key_set && { issuer_key_set }),
		...(proof_time && { proof_time: new Tag(proof_time.toISOString(), 0) }),
		...(results && { results }),
	});
}

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
