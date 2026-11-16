/**
 * The superseded secret-bearing members of a response-level `credential_metadata`. Only Credential
 * Auxiliary Data v0.1 remains; a response that still carries one of these is refused, never ignored
 * (the same five names the Kotlin SDK refuses with LEGACY_SECRET_MEMBER, siros-sdk-kotlin #337).
 */
export const LEGACY_SECRET_MEMBERS = [
	'org.siros.secret_seed',
	'org.siros.holder_commitments',
	'org.siros.psc',
	'holder_commitments',
	'secret_members',
] as const;

/**
 * Whether a response-level `credential_metadata` has one of the legacy members, by exact member name
 * and whatever its value (a presence check: the value is never read).
 */
export function carriesLegacySecretMember(credentialMetadata: unknown): boolean {
	if (!credentialMetadata || typeof credentialMetadata !== 'object' || Array.isArray(credentialMetadata)) {
		return false;
	}
	return LEGACY_SECRET_MEMBERS.some((member) => Object.hasOwn(credentialMetadata, member));
}
