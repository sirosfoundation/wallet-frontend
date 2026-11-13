/** Key-management algorithms a client-held response key can serve (ECDH family only). */
export const RESPONSE_KEY_ALGS = ['ECDH-ES', 'ECDH-ES+A128KW', 'ECDH-ES+A256KW'] as const;

/** Content-encryption algorithms the wallet uses and decrypts. */
export const RESPONSE_ENCS = ['A128GCM', 'A256GCM', 'A128CBC-HS256', 'A256CBC-HS512'] as const;

export function isSupportedAlg(alg: string): boolean {
	return (RESPONSE_KEY_ALGS as readonly string[]).includes(alg);
}

export function isSupportedEnc(enc: string): boolean {
	return (RESPONSE_ENCS as readonly string[]).includes(enc);
}
