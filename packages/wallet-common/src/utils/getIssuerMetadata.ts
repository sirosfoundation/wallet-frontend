import type { z } from 'zod';
import type { IAuthZENClient } from '../authzen/AuthZENClient';
import { CredentialParsingError } from '../error';
import type { HttpClient } from '../interfaces';
import { OpenidCredentialIssuerMetadataSchema } from '../schemas';
import type { MetadataWarning } from '../types';

// biome-ignore lint/complexity/useMaxParams: baseline: pre-existing debt. should be fixed
export async function getIssuerMetadata(
	httpClient: HttpClient,
	issuer: string | undefined,
	warnings: MetadataWarning[],
	useCache?: boolean,
	authzenClient?: IAuthZENClient,
): Promise<{
	metadata: z.infer<typeof OpenidCredentialIssuerMetadataSchema> | null;
}> {
	if (!issuer) return { metadata: null };

	if (authzenClient) {
		return getIssuerMetadataViaResolve(authzenClient, issuer, warnings, useCache);
	}

	// RFC 8615 well-known URI construction: /.well-known/{suffix}{path}
	// Strip trailing slash per OID4VCI §12.2.1
	let url: string;
	try {
		const issuerUrl = new URL(issuer);
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		const path = issuerUrl.pathname.replace(/\/+$/, '');
		url = `${issuerUrl.origin}/.well-known/openid-credential-issuer${path}`;
	} catch {
		warnings.push({
			code: CredentialParsingError.FailFetchIssuerMetadata,
		});
		return { metadata: null };
	}

	// biome-ignore lint/suspicious/noEvolvingTypes: baseline: pre-existing debt. should be fixed
	let issuerResponse = null;

	try {
		issuerResponse = await httpClient.get(url, { Accept: 'application/json' }, { useCache });
		// biome-ignore lint/complexity/noUselessCatchBinding: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
	} catch (err) {
		warnings.push({
			code: CredentialParsingError.FailFetchIssuerMetadata,
		});
		return { metadata: null };
	}

	// biome-ignore lint/complexity/useOptionalChain: baseline: pre-existing debt. should be fixed
	if (!issuerResponse || issuerResponse.status !== 200 || !issuerResponse.data) {
		warnings.push({
			code: CredentialParsingError.FailFetchIssuerMetadata,
		});
		return { metadata: null };
	}

	const parsed = OpenidCredentialIssuerMetadataSchema.safeParse(issuerResponse.data);

	if (!parsed.success) {
		warnings.push({
			code: CredentialParsingError.FailSchemaIssuerMetadata,
		});
		return { metadata: null };
	}

	return { metadata: parsed.data };
}

async function getIssuerMetadataViaResolve(
	authzenClient: IAuthZENClient,
	issuer: string,
	warnings: MetadataWarning[],
	useCache?: boolean,
): Promise<{
	metadata: z.infer<typeof OpenidCredentialIssuerMetadataSchema> | null;
}> {
	try {
		const result = await authzenClient.resolve(issuer, {
			resourceType: 'credential_issuer',
			useCache,
		});
		if (!result.ok) {
			warnings.push({ code: CredentialParsingError.FailFetchIssuerMetadata });
			return { metadata: null };
		}

		const trustMetadata = result.value.context?.trust_metadata;
		if (!trustMetadata) {
			warnings.push({ code: CredentialParsingError.FailFetchIssuerMetadata });
			return { metadata: null };
		}

		const parsed = OpenidCredentialIssuerMetadataSchema.safeParse(trustMetadata);
		if (!parsed.success) {
			warnings.push({ code: CredentialParsingError.FailSchemaIssuerMetadata });
			return { metadata: null };
		}

		return { metadata: parsed.data };
	} catch {
		warnings.push({ code: CredentialParsingError.FailFetchIssuerMetadata });
		return { metadata: null };
	}
}
