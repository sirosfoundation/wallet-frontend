/**
 * These are the constraints that cannot live in the circuit
 * catalogue's `capabilities`, which is descriptive and limited to per-param
 * enum/type. Cross-parameter and range rules, e.g. nym_auth's `age_check`
 * requiring `le >= ge` and a span of at least 365 days are neither expressible
 * there nor enforced by the circuits, so the wallet owns them.
 *
 * @todo We should consider if this level of specificity belongs here.
 */

import type {
	IZkpReqCredentialQuery,
	IZkpReqReqFunction,
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
	assert(credential: IZkpReqCredentialQuery): void;
	sourceAttributes(credential: IZkpReqCredentialQuery): string[];
}

// ============================================================
// Nym Auth Policy
// ============================================================

class NymAuthPolicy implements IAttestationPolicy {
	readonly #MIN_AGE_RANGE_DAYS = 365;
	readonly #MAX_VERIFIER_CONTEXT_BYTES = 64;
	readonly #SINGLE_ITEM_FUNCTIONS = ['pseudonym', 'age_check'];
	readonly #PSEUDONYM_CONFIGS = [
		'known-offender-matching-ssc',
		'known-offender-matching-psc',
		'account-recovery-ssc',
		'user-managed-pseudonym-xsite-ssc',
	];

	assert(credential: IZkpReqCredentialQuery): void {
		this.#assertSingleItems(credential);
		this.#assertPseudonymParams(credential);
		this.#assertAgeCheckBounds(credential);
	}

	/** A `_req` holds at most one item of each of these functions. */
	#assertSingleItems(credential: IZkpReqCredentialQuery): void {
		for (const fnId of this.#SINGLE_ITEM_FUNCTIONS) {
			const count = credential.functions.filter((f) => f.fnId === fnId).length;
			if (count > 1) {
				throw new AttestationPolicyViolation(
					`_req must not contain more than one \`${fnId}\` item`,
				);
			}
		}
	}

	#assertPseudonymParams(credential: IZkpReqCredentialQuery): void {
		for (const fn of credential.functions) {
			if (fn.fnId !== 'pseudonym') continue;

			const { config, ver, prf, verifier_context } = this.#paramsOf(fn);

			if (typeof config !== 'string' || !this.#PSEUDONYM_CONFIGS.includes(config)) {
				throw new AttestationPolicyViolation(
					`pseudonym \`config\` must be one of ${this.#PSEUDONYM_CONFIGS.join(', ')}`,
				);
			}

			if (ver !== 1) {
				throw new AttestationPolicyViolation('pseudonym `ver` must be 1');
			}

			if (!this.#isPrfAllowed(credential.meta.sourceFormat, config, prf)) {
				throw new AttestationPolicyViolation(
					`pseudonym \`prf\` is not defined for source_format '${credential.meta.sourceFormat}' and config '${config}'`,
				);
			}

			if (config !== 'account-recovery-ssc') {
				if (verifier_context !== undefined) {
					throw new AttestationPolicyViolation(
						`pseudonym \`verifier_context\` must not be present for config '${config}'`,
					);
				}
				continue;
			}

			if (typeof verifier_context !== 'string') {
				throw new AttestationPolicyViolation(
					'pseudonym `verifier_context` is required for config account-recovery-ssc',
				);
			}

			const bytes = new TextEncoder().encode(verifier_context).length;
			if (bytes < 1 || bytes > this.#MAX_VERIFIER_CONTEXT_BYTES) {
				throw new AttestationPolicyViolation(
					`pseudonym \`verifier_context\` must be 1-${this.#MAX_VERIFIER_CONTEXT_BYTES} bytes of UTF-8`,
				);
			}
		}
	}

	#isPrfAllowed(sourceFormat: string, config: string, prf: JsonValue): boolean {
		switch (sourceFormat) {
			case 'mso_mdoc':
				return prf === 'sha-256';
			case 'bbs_cd':
				return prf === 'hashdh-bls12381g1' && config === 'known-offender-matching-ssc';
			default:
				return false;
		}
	}

	/**
	 * age_check needs >=1 of ge/le; if both, le >= ge and span >= 365 days.
	 */
	#assertAgeCheckBounds(credential: IZkpReqCredentialQuery): void {
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

	#paramsOf(fn: IZkpReqReqFunction): Record<string, JsonValue> {
		return fn.params ?? {};
	}

	/**
	 * The attestation attributes the requested functions read (rulebook source bindings).
	 */
	sourceAttributes(credential: IZkpReqCredentialQuery): string[] {
		const attrs = new Set<string>();

		for (const fn of credential.functions) {
			switch (fn.fnId) {
				case 'age_check':
					attrs.add('birth_date');
					break;
				case 'pseudonym': {
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
	credential: IZkpReqCredentialQuery,
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
	credential: IZkpReqCredentialQuery,
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
