import { TokenStatus } from '@sirosfoundation/token-status-list';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import type{ OID4VCIRefreshEntry } from '@/services/extensions/oid4vci-refresh';
import { requirementsForCredential } from '@/lib/wscd-manager/utils';
import { ReissueBlocker } from './types';
import { ReissueNotice } from './resources';

/**
 * When the batch should be reissued: now if it is running out of instances,
 * otherwise when less than 10% of its validity is left. Null if it never
 * should, e.g. when revoked.
 */
export function reissueDueAt(
	credential: ExtendedVcEntity,
	now: Date = new Date(),
): Date | null {
	if (TokenStatus.isBlocked(credential.status)) return null;
	if (isRunningLow(credential)) return now;

	return validityDueAt(credential);
}

function validityDueAt(credential: ExtendedVcEntity): Date | null {
	const { validFrom, validUntil, signed } =
		credential.parsedCredential.validityInfo;
	const start = validFrom ?? signed;
	if (!start || !validUntil) return null;

	const total = validUntil.getTime() - start.getTime();

	return new Date(validUntil.getTime() - total * 0.1);
}

function isRunningLow(credential: ExtendedVcEntity): boolean {
	const instances = credential.instances;
	if (instances.length < 2) return false;

	const usableInstances = instances.filter(
		(i) =>
			i.sigCount === 0 &&
			(i.status === undefined || !TokenStatus.isBlocked(i.status)),
	);

	return usableInstances.length < 2;
}

/**
 * Why the batch can't be reissued in the background, if it can't.
 */
export function reissueBlocker(
	credential: ExtendedVcEntity,
	refreshEntry: OID4VCIRefreshEntry | undefined,
): ReissueBlocker | undefined {
	if (!refreshEntry) return ReissueNotice.NO_REFRESH_TOKEN;
	if (refreshEntry.dpopKid) return ReissueNotice.HARDWARE_BOUND;

	const keyNeedsUser = requirementsForCredential(credential.kid).factors
		.some((factor) => factor.kind !== 'none');
	if (keyNeedsUser) return ReissueNotice.HARDWARE_BOUND;

	return undefined;
}
