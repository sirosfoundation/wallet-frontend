import type { CredentialConfigurationSupported } from '../schemas/CredentialConfigurationSupportedSchema';
import type { TypeDisplayEntry } from '../schemas/SdJwtVcTypeMetadataSchema';
import type { FriendlyNameCallback } from '../types';
import { matchDisplayByLocale } from '../utils/matchLocalizedDisplay';

type IssuerDisplayEntry = NonNullable<
	NonNullable<CredentialConfigurationSupported['credential_metadata']>['display']
>[number];

type FriendlyNameResolverOptions = {
	credentialDisplayArray?: TypeDisplayEntry[];
	issuerDisplayArray?: IssuerDisplayEntry[];
	fallbackName?: string;
};

export function friendlyNameResolver({
	credentialDisplayArray,
	issuerDisplayArray,
	fallbackName = 'Verifiable Credential',
}: FriendlyNameResolverOptions): FriendlyNameCallback {
	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	return async (preferredLangs: string[] = ['en-US']): Promise<string | null> => {
		// 1) Credential display name
		const credentialDisplayLocalized = matchDisplayByLocale(credentialDisplayArray, preferredLangs);

		if (credentialDisplayLocalized?.name) {
			return credentialDisplayLocalized.name;
		}

		// 2) Issuer display name
		const issuerDisplayLocalized = matchDisplayByLocale(issuerDisplayArray, preferredLangs);

		if (issuerDisplayLocalized?.name) {
			return issuerDisplayLocalized.name;
		}

		return fallbackName;
	};
}
