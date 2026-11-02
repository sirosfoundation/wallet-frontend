import { CircleXIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { TokenStatus } from '@sirosfoundation/token-status-list';

export type CredentialStatus = {
	icon: LucideIcon;
	badgeClassName: string;
	panelClassName: string;
	iconClassName: string;
	labelKey: string;
	shortKey: string;
	titleKey: string;
	descriptionKey: string;
	isReissuable: boolean;
};

// Class names are written out in full so Tailwind can find them.
export const CREDENTIAL_STATUSES = {
	expired: {
		icon: CircleXIcon,
		badgeClassName: 'text-lm-red dark:text-dm-red border-lm-red dark:border-dm-red',
		panelClassName: 'border-lm-red dark:border-dm-red bg-lm-red-dark/10 dark:bg-dm-red-dark/10',
		iconClassName: 'text-lm-red dark:text-dm-red',
		labelKey: 'pageCredentials.status.expired.label',
		shortKey: 'pageCredentials.status.expired.short',
		titleKey: 'pageCredentials.status.expired.title',
		descriptionKey: 'pageCredentials.status.expired.description',
		isReissuable: true,
	},
	invalid: {
		icon: CircleXIcon,
		badgeClassName: 'text-lm-red dark:text-dm-red border-lm-red dark:border-dm-red',
		panelClassName: 'border-lm-red dark:border-dm-red bg-lm-red-dark/10 dark:bg-dm-red-dark/10',
		iconClassName: 'text-lm-red dark:text-dm-red',
		labelKey: 'pageCredentials.status.invalid.label',
		shortKey: 'pageCredentials.status.invalid.short',
		titleKey: 'pageCredentials.status.invalid.title',
		descriptionKey: 'pageCredentials.status.invalid.description',
		isReissuable: false,
	},
	suspended: {
		icon: TriangleAlertIcon,
		badgeClassName: 'text-lm-orange dark:text-dm-orange border-lm-orange dark:border-dm-orange',
		panelClassName: 'border-lm-orange dark:border-dm-orange bg-lm-orange-bg/10 dark:bg-dm-orange-bg/10',
		iconClassName: 'text-lm-orange dark:text-dm-orange',
		labelKey: 'pageCredentials.status.suspended.label',
		shortKey: 'pageCredentials.status.suspended.short',
		titleKey: 'pageCredentials.status.suspended.title',
		descriptionKey: 'pageCredentials.status.suspended.description',
		isReissuable: false,
	},
	batchExhausted: {
		icon: TriangleAlertIcon,
		badgeClassName: 'text-lm-orange dark:text-dm-orange border-lm-orange dark:border-dm-orange',
		panelClassName: 'border-lm-orange dark:border-dm-orange bg-lm-orange-bg/10 dark:bg-dm-orange-bg/10',
		iconClassName: 'text-lm-orange dark:text-dm-orange',
		labelKey: 'pageCredentials.status.batchExhausted.label',
		shortKey: 'pageCredentials.status.batchExhausted.short',
		titleKey: 'pageCredentials.status.batchExhausted.title',
		descriptionKey: 'pageCredentials.status.batchExhausted.description',
		isReissuable: true,
	},
} satisfies Record<string, CredentialStatus>;

/**
 * Statuses that apply to a credential, most severe first.
 */
export function getCredentialStatuses(vcEntity?: ExtendedVcEntity): CredentialStatus[] {
	const statuses: CredentialStatus[] = [];
	if (vcEntity?.isExpired) statuses.push(CREDENTIAL_STATUSES.expired);
	if (vcEntity?.status === TokenStatus.INVALID) statuses.push(CREDENTIAL_STATUSES.invalid);
	if (vcEntity?.status === TokenStatus.SUSPENDED) statuses.push(CREDENTIAL_STATUSES.suspended);
	if (vcEntity?.isBatchExhausted) statuses.push(CREDENTIAL_STATUSES.batchExhausted);
	return statuses;
}
