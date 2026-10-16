/**
 * These are the constraints that cannot live in the circuit
 * catalogue's `capabilities`, which is descriptive and limited to per-param
 * enum/type. Cross-parameter and range rules, e.g. nym_auth's `age_check`
 * requiring `le >= ge` and a span of at least 365 days are neither expressible
 * there nor enforced by the circuits, so the wallet owns them.
 */

import type {
	ICircuitZkCredentialQuery,
	ICircuitZkReqFunction,
	JsonValue,
} from './types';

export class AttestationPolicyViolation extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AttestationPolicyViolation';
	}
}

/**
 * The rulebook policies for one attestation type.
 */
interface IAttestationPolicy {
	assert(credential: ICircuitZkCredentialQuery): void;
	sourceAttributes(credential: ICircuitZkCredentialQuery): string[];
}

// ============================================================
// Nym Auth Policy
// ============================================================

class NymAuthPolicy implements IAttestationPolicy {
	readonly #MIN_AGE_RANGE_DAYS = 365;

	assert(credential: ICircuitZkCredentialQuery): void {
		this.#assertAgeCheckBounds(credential);
	}

	/**
	 * age_check needs >=1 of ge/le; if both, le >= ge and span >= 365 days.
	 */
	#assertAgeCheckBounds(credential: ICircuitZkCredentialQuery): void {
		for (const fn of credential.functions) {
			if (fn.fnId !== 'age_check') continue;

			const params = this.#paramsOf(fn);

			const ge =
				params.ge === undefined
					? undefined
					: this.#assertAgeCheckFullDate(params.ge, 'ge');

			const le =
				params.le === undefined
					? undefined
					: this.#assertAgeCheckFullDate(params.le, 'le');

			if (ge === undefined && le === undefined) {
				throw new AttestationPolicyViolation(
					'age_check requires at least one of `ge` or `le`',
				);
			}

			if (ge !== undefined && le !== undefined) {
				if (le < ge) {
					throw new AttestationPolicyViolation(
						'age_check `le` must not be earlier than `ge`',
					);
				}
				if (le - ge + 1 < this.#MIN_AGE_RANGE_DAYS) {
					throw new AttestationPolicyViolation(
						`age_check range must span at least ${this.#MIN_AGE_RANGE_DAYS} days`,
					);
				}
			}
		}
	}

	/** Assert a param is an RFC 3339 full-date; return it as epoch days (UTC). */
	#assertAgeCheckFullDate(value: JsonValue, name: string): number {
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			throw new AttestationPolicyViolation(
				`age_check \`${name}\` must be an RFC 3339 full-date`,
			);
		}

		const ms = Date.parse(`${value}T00:00:00Z`);
		if (Number.isNaN(ms)) {
			throw new AttestationPolicyViolation(
				`age_check \`${name}\` is not a valid date`,
			);
		}

		return Math.floor(ms / 86_400_000);
	}

	#paramsOf(fn: ICircuitZkReqFunction): Record<string, JsonValue> {
		const p = fn.params;

		return p && typeof p === 'object' && !Array.isArray(p)
			? (p as Record<string, JsonValue>)
			: {};
	}

	/**
	 * The attestation attributes the requested functions read (rulebook source bindings).
	 */
	sourceAttributes(credential: ICircuitZkCredentialQuery): string[] {
		const attrs = new Set<string>();

		for (const fn of credential.functions) {
			switch (fn.fnId) {
				case 'age_check':
					attrs.add('birth_date');
					break;
				case 'pseudonym-v1-sha256': {
					const config = this.#paramsOf(fn).config;
					attrs.add(config === 'known-offender-matching-psc' ? 'psc' : 'ssc');
					break;
				}
			}
		}

		return [...attrs];
	}
}

// ============================================================
// Registry + dispatch
// ============================================================

const policiesByDocType: Record<string, IAttestationPolicy> = {
	'eu.europa.ec.eudi.nym_auth.1': new NymAuthPolicy(),
};

const policiesByVct: Record<string, IAttestationPolicy> = {};

/**
 * Resolve the attestation type (docType or vct) of a credential query and run
 * its policy, if one is registered. No registered policy means nothing to assert.
 */
export function assertAttestationPolicies(
	credential: ICircuitZkCredentialQuery,
): void {
	const { docTypeValue, vctValues } = credential.meta;

	if (docTypeValue) {
		policiesByDocType[docTypeValue]?.assert(credential);
		return;
	}

	for (const vct of vctValues ?? []) {
		policiesByVct[vct]?.assert(credential);
	}
}

/** Source attributes the request's functions read, for the credential's attestation type. */
export function attestationSourceAttributes(
	credential: ICircuitZkCredentialQuery,
): string[] {
	const { docTypeValue, vctValues } = credential.meta;

	if (docTypeValue) {
		return policiesByDocType[docTypeValue]?.sourceAttributes(credential) ?? [];
	}

	for (const vct of vctValues ?? []) {
		const policy = policiesByVct[vct];
		if (policy) return policy.sourceAttributes(credential);
	}

	return [];
}
