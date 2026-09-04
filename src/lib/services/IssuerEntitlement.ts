/**
 * Issuer entitlement checking (ARF v3.0.0 §6.6.2.3).
 *
 * Under CIR (EU) 2025/848 a PID or attestation provider is a registered
 * wallet-relying party in its own right: it presents the same two documents a
 * verifier does — an access certificate (WRPAC) proving who it is, and a
 * registration certificate (WRPRC) saying what it registered for. Per ETSI
 * TS 119 472-3 the provider puts both in its OpenID4VCI Issuer Metadata.
 *
 * Trust and entitlement answer different questions and are deliberately kept
 * apart: `evaluateIssuerTrust` asks *is this issuer known and trusted*, while
 * this asks *is it registered to issue the specific thing it is offering*. An
 * issuer can be perfectly trusted and still not be registered for a given
 * attestation type.
 *
 * The decision is made by go-wallet-backend's `pkg/issuertrust`, reached
 * through `POST /v1/resolve`. Making it wallet-side would mean a second
 * certificate-handling implementation in every client, kept in sync by hand.
 *
 * This calls the endpoint directly rather than going through wallet-common's
 * `AuthZENClient.resolve`, for two reasons: that wrapper cannot carry the
 * offered `credential_types` (so the per-type check could not run at all), and
 * it caches responses under a key that does not include them — which would
 * serve an entitlement decision computed for a different credential.
 */

import type { HttpClient } from 'wallet-common';
import { logger } from '@/logger';

/**
 * One thing that did not check out about a provider's registration.
 *
 * `code` is stable and meant to be acted on; `message` is for humans.
 */
export interface IssuerEntitlementFinding {
	/** e.g. `attestation_type_not_registered`, `registration_certificate_expired`. */
	code: string;
	message: string;
	/** The offered type, when the finding is about one. */
	credential_type?: string;
}

/**
 * What the backend concluded about a provider's entitlement.
 *
 * `evaluated` is deliberately separate from `allowed`: "not checked" must never
 * read as "checked and fine". A decision that was not evaluated carries no
 * assurance at all, whatever `allowed` says.
 */
export interface IssuerEntitlement {
	/** Whether issuance may proceed. Stays true in warn mode even with findings. */
	allowed: boolean;
	/** `warn`, `fail` or `off` — which mode produced this decision. */
	mode: string;
	/** False when there was nothing to evaluate against. */
	evaluated: boolean;
	findings: IssuerEntitlementFinding[];
	/** What the registration certificate claimed, for display. */
	entitlements: string[];
	/** The provider identifier from the registration certificate. */
	subject?: string;
}

export interface IssuerEntitlementConfig {
	httpClient: HttpClient;
	backendUrl: string;
	getAuthToken: () => string | Promise<string>;
	tenantId: string;
}

export interface IssuerEntitlementParams {
	/** The credential issuer identifier (URL). */
	issuerId: string;
	/**
	 * The credential configuration IDs or types being offered. Without these
	 * the backend can still check the provider's role, but not whether it
	 * registered for this particular attestation type.
	 */
	credentialTypes?: string[];
}

/**
 * Checks whether an issuer is entitled to issue what it is offering.
 *
 * Resolves to `null` when the check could not run at all — see
 * {@link createIssuerEntitlementChecker}.
 */
export type IssuerEntitlementChecker = (
	params: IssuerEntitlementParams,
) => Promise<IssuerEntitlement | null>;

/** Narrows an unknown resolve response to a decision, tolerating omitted fields. */
function parseEntitlement(value: unknown): IssuerEntitlement | null {
	if (typeof value !== 'object' || value === null) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.allowed !== 'boolean') return null;

	const findings = Array.isArray(raw.findings)
		? raw.findings.flatMap((f): IssuerEntitlementFinding[] => {
				if (typeof f !== 'object' || f === null) return [];
				const rf = f as Record<string, unknown>;
				if (typeof rf.code !== 'string') return [];
				return [{
					code: rf.code,
					message: typeof rf.message === 'string' ? rf.message : '',
					credential_type: typeof rf.credential_type === 'string' ? rf.credential_type : undefined,
				}];
			})
		: [];

	return {
		allowed: raw.allowed,
		mode: typeof raw.mode === 'string' ? raw.mode : 'warn',
		evaluated: raw.evaluated === true,
		findings,
		entitlements: Array.isArray(raw.entitlements)
			? raw.entitlements.filter((e): e is string => typeof e === 'string')
			: [],
		subject: typeof raw.subject === 'string' ? raw.subject : undefined,
	};
}

/**
 * Create an issuer entitlement checker backed by the wallet backend.
 *
 * Returns `null` whenever the check could not be made — no backend, a network
 * failure, or a response without a decision. `null` means "not checked", and a
 * check that could not run must never be reported as a pass, nor block
 * issuance: the same distinction the backend draws between "revoked" and
 * "could not determine". Making issuance depend on this round-trip succeeding
 * would turn a backend outage into an outage for every issuer.
 */
export function createIssuerEntitlementChecker(
	config: IssuerEntitlementConfig,
): IssuerEntitlementChecker {
	const baseUrl = config.backendUrl.replace(/\/$/, '');

	return async ({ issuerId, credentialTypes }: IssuerEntitlementParams) => {
		try {
			const token = await Promise.resolve(config.getAuthToken());
			const body: Record<string, unknown> = {
				subject_id: issuerId,
				subject_type: 'url',
				resource_type: 'credential_issuer',
			};
			if (credentialTypes && credentialTypes.length > 0) {
				body.credential_types = credentialTypes;
			}

			const response = await config.httpClient.post(`${baseUrl}/v1/resolve`, body, {
				'Authorization': `Bearer ${token}`,
				'X-Tenant-ID': config.tenantId,
				'Content-Type': 'application/json',
			});

			if (response.status !== 200 || typeof response.data !== 'object' || response.data === null) {
				logger.warn('[IssuerEntitlement] resolve returned no usable decision for', issuerId);
				return null;
			}

			return parseEntitlement((response.data as Record<string, unknown>).issuer_entitlement);
		} catch (error) {
			logger.warn('[IssuerEntitlement] could not check entitlement for', issuerId, error);
			return null;
		}
	};
}

/**
 * Whether this decision is a refusal.
 *
 * Only an explicit `allowed: false` refuses. A missing decision is "not
 * checked", not a failure, and warn mode reports findings while still leaving
 * `allowed` true — warn is the default until the ARF's 24-month registration
 * obligation takes effect, and refusing unregistered providers before then
 * would break issuance that is currently legitimate.
 */
export function isEntitlementRefused(entitlement: IssuerEntitlement | null): boolean {
	return entitlement !== null && entitlement.allowed === false;
}

/** A single human-readable line naming why entitlement was refused. */
export function describeEntitlementFindings(entitlement: IssuerEntitlement): string {
	if (entitlement.findings.length === 0) {
		return 'the issuer is not registered to issue this credential';
	}
	return entitlement.findings.map((f) => `${f.code}: ${f.message}`).join(', ');
}
