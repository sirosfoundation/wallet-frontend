import { CredentialVerificationError } from './error';
import type { CredentialVerifier, VerifyingEngineI } from './interfaces';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import { VerifiableCredentialFormat } from './types';

export function VerifyingEngine(): VerifyingEngineI {
	const verifiers: CredentialVerifier[] = [];

	return {
		register(credentialVerifier: CredentialVerifier) {
			verifiers.push(credentialVerifier);
		},

		async verify({
			rawCredential,
			opts,
		}: {
			rawCredential: unknown;
			opts: {
				expectedNonce?: string;
				expectedAudience?: string;
			};
		}) {
			let lastError: CredentialVerificationError | null = null;
			for (const v of verifiers) {
				// biome-ignore lint/performance/noAwaitInLoops: baseline: pre-existing debt. should be fixed
				const result = await v.verify({ rawCredential, opts });
				if (result.success) {
					return result;
				}
				lastError = result.error;
			}

			return {
				success: false,
				error: lastError ? lastError : CredentialVerificationError.UnknownProblem,
			};
		},
	};
}
