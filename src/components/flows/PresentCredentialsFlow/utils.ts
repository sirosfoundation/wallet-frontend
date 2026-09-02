import { isValidElement } from 'react';
import { DcqlQuery } from 'dcql';
import { OID4VPVerifierInfo } from '@/lib/openid-flow';
import { ExtendedVcEntity } from '@/context/CredentialsContext';
import { prettyDomain } from '@/utils';
import type {
	ConformantCredentials,
	PresentCredentialsRequest,
	PresentCredentialsVerifier,
	PresentCredentialsQuery,
	PresentCredentialSet,
} from './types';
import { logger } from '@/logger';
import { normalizePath } from '@/util';

/**
 * Resolve a credential presentation request into a PresentCredentialsRequest object.
 * This includes shaping the credentials, extracting available claims, and resolving display information.
 */
export async function resolveCredentialPresentationRequest(
	verifierInfo: OID4VPVerifierInfo,
	dcqlQuery: DcqlQuery.Input,
	conformantCredentials: ConformantCredentials,
	vcEntityList: ExtendedVcEntity[],
	preferredLanguages: string[],
): Promise<PresentCredentialsRequest> {
	const verifier: PresentCredentialsVerifier = {
		name: verifierInfo.name,
		domain: prettyDomain(verifierInfo.domain),
		logo: verifierInfo.logo,
	};

	const queries: PresentCredentialsQuery[] = await Promise.all(
		dcqlQuery.credentials.map(async (query) => {
			const id = query.id;

			const conformant = conformantCredentials.get(id);

			const seen = new Set<string>();
			const requestedFields = (conformant?.requestedFields ?? []).filter((f) => {
				const key = JSON.stringify(normalizePath(f.path ?? []));
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});

			const matches = await Promise.all(
				vcEntityList
					.filter((vcEntity) => {
						if (!conformant) return false;

						return conformant.credentials.includes(vcEntity.batchId);
					})
					.map(async (vcEntity) => {
						const { parsedCredential } = vcEntity;
						const { name, rendering } = parsedCredential.metadata.credential;
						const claims = parsedCredential.metadata.credential.TypeMetadata?.claims ?? [];

						let display = {
							name: `Credential ${vcEntity.batchId}`,
							issuer: undefined as string | undefined,
							backgroundColor: undefined as string | undefined,
							textColor: undefined as string | undefined,
							logo: undefined as string | undefined,
						};
						try {
							const [resolvedName, branding] = await Promise.all([
								name(preferredLanguages),
								rendering(preferredLanguages),
							]);
							display = {
								name: resolvedName ?? display.name,
								backgroundColor: branding.backgroundColor,
								textColor: branding.textColor,
								logo: branding.logo,
								issuer:
									parsedCredential.metadata.issuer.name ?? parsedCredential.metadata.issuer.id,
							};
						} catch (e) {
							logger.warn('Credential metadata failed; using fallback display', {
								batchId: vcEntity.batchId,
								e,
							});
						}

						return {
							batchId: vcEntity.batchId,
							display,
							fields: requestedFields.map((f) => ({
								path: JSON.stringify(normalizePath(f.path ?? [])),
								name: resolveClaimLabel(claims, f, preferredLanguages),
								value: getValueByPath(normalizePath(f.path ?? []), parsedCredential.signedClaims),
							})),
						};
					}),
			);

			return {
				id,
				matches,
			};
		}),
	);

	const sets: PresentCredentialSet[] = dcqlQuery.credential_sets?.length
		? dcqlQuery.credential_sets.map((set) => ({
				purpose: set.purpose != null ? String(set.purpose) : undefined,
				required: set.required,
				options: set.options,
			}))
		: [
				{
					required: true,
					options: [dcqlQuery.credentials.map((c) => c.id)],
				},
			];

	return {
		verifier,
		queries,
		sets,
	};
}

/**
 * Get a value from an object by a path array, where null segments indicate
 * 'any key'.
 *
 * @example
 * ```ts
 * getValueByPath(['a', null, 'c'], { a: { x: { c: 1 }, y: { c: 2 } } });
 * // [1, 2]
 * ```
 */
export function getValueByPath(
	path: Array<string | number | null>,
	obj: Record<string, unknown>,
): any {
	if (!Array.isArray(path) || path.length === 0) return undefined;

	const traverse = (segments: Array<string | number | null>, current: unknown): unknown => {
		if (segments.length === 0) return current;
		const [head, ...tail] = segments;

		if (head === null && typeof current === 'object' && current !== null) {
			return Object.values(current)
				.map((item) => traverse(tail, item))
				.filter((v) => v !== undefined);
		}

		if (head !== null && current && typeof current === 'object' && head in current) {
			return traverse(tail, (current as Record<string | number, unknown>)[head]);
		}
		return undefined;
	};

	const result = traverse(path, obj);

	if (
		typeof result === 'object' &&
		result !== null &&
		!isValidElement(result) &&
		Object.keys(result).length === 0
	) {
		return undefined;
	}

	return result;
}

/**
 * Resolve a claim label from the claims metadata, falling back to
 * the field name or path if no label is found.
 */
export function resolveClaimLabel(
	claims: Array<{
		path: Array<string | number | null>;
		display?: Array<{ locale: string; label: string }>;
	}>,
	field: { name?: string; path?: string[] },
	preferredLanguages: string[],
): string {
	const target = JSON.stringify(field.path ?? []);
	const claim = claims.find((c) => JSON.stringify(c.path.filter((s) => s !== null)) === target);
	const label =
		preferredLanguages
			.map((locale) => claim?.display?.find((d) => d.locale === locale)?.label)
			.find((l) => l != null) ?? claim?.display?.[0]?.label;

	return label ?? field.name ?? field.path?.filter(Boolean).join(' › ') ?? 'Unknown';
}
