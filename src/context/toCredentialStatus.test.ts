import { describe, expect, it, vi } from 'vitest';

// The revoked/suspended/not-yet-valid members arrive with wallet-common#35. Until the re-pin the
// installed enum has only some of them, and reading a missing member yields undefined — which
// would make several switch cases collide and the assertions below meaningless. Mocking the enum
// keeps this a test of the mapping rather than of which library version happens to be installed.
const { CredentialVerificationError } = vi.hoisted(() => ({
	CredentialVerificationError: {
		ExpiredCredential: 'ExpiredCredential',
		NotYetValidCredential: 'NotYetValidCredential',
		RevokedCredential: 'RevokedCredential',
		SuspendedCredential: 'SuspendedCredential',
		InvalidSignature: 'InvalidSignature',
		CannotResolveIssuerPublicKey: 'CannotResolveIssuerPublicKey',
	},
}));

vi.mock('wallet-common', async (importOriginal) => ({
	...(await importOriginal<typeof import('wallet-common')>()),
	CredentialVerificationError,
}));

const { toCredentialStatus } = await import('./CredentialsContextProvider');

describe('toCredentialStatus', () => {
	// These four are the outcomes of the DIIP v5 validity and revocation algorithm, and each one
	// gets its own badge — a revoked credential must not be shown to the user as merely expired.
	it.each([
		['ExpiredCredential', 'expired'],
		['NotYetValidCredential', 'notYetValid'],
		['RevokedCredential', 'revoked'],
		['SuspendedCredential', 'suspended'],
	])('maps %s to %s', (error, expected) => {
		expect(toCredentialStatus(error as never)).toBe(expected);
	});

	// Anything else is a verification failure the holder cannot act on, and labelling the
	// credential would tell them something untrue about why it is unusable.
	it.each(['InvalidSignature', 'CannotResolveIssuerPublicKey'])(
		'leaves %s unset rather than inventing a status',
		(error) => {
			expect(toCredentialStatus(error as never)).toBeNull();
		},
	);
});
