import { CircleXIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { TokenStatus } from '@sirosfoundation/token-status-list';
import { ReissueNotice } from '@/lib/openid-reissuance';

export type CredentialStatus = {
	icon: LucideIcon;
	severity: 'low' | 'medium' | 'high';
	badgeClassName: string;
	panelClassName: string;
	iconClassName: string;
	labelKey: string;
	shortKey: string;
	titleKey: string;
	descriptionKey: string;
	isReissuable: boolean;
};


const THEME_DANGER = {
	icon: CircleXIcon,
	badgeClassName: 'text-lm-red dark:text-dm-red border-lm-red dark:border-dm-red',
	panelClassName: 'border-lm-red dark:border-dm-red bg-lm-red-dark/10 dark:bg-dm-red-dark/10',
	iconClassName: 'text-lm-red dark:text-dm-red',
}

const THEME_WARN = {
	icon: TriangleAlertIcon,
	badgeClassName: 'bg-lm-orange text-black dark:text-dm-orange border-white dark:border-dm-orange',
	panelClassName: 'border-lm-orange dark:border-dm-orange bg-lm-orange-bg/10 dark:bg-dm-orange-bg/10',
	iconClassName: 'text-lm-orange dark:text-dm-orange',
}

// Class names are written out in full so Tailwind can find them.
export const CREDENTIAL_STATUSES = {
	expired: {
		...THEME_DANGER,
		severity: 'medium',
		labelKey: 'pageCredentials.status.expired.label',
		shortKey: 'pageCredentials.status.expired.short',
		titleKey: 'pageCredentials.status.expired.title',
		descriptionKey: 'pageCredentials.status.expired.description',
		isReissuable: true,
	},
	invalid: {
		...THEME_DANGER,
		severity: 'high',
		labelKey: 'pageCredentials.status.invalid.label',
		shortKey: 'pageCredentials.status.invalid.short',
		titleKey: 'pageCredentials.status.invalid.title',
		descriptionKey: 'pageCredentials.status.invalid.description',
		isReissuable: false,
	},
	suspended: {
		...THEME_DANGER,
		severity: 'high',
		labelKey: 'pageCredentials.status.suspended.label',
		shortKey: 'pageCredentials.status.suspended.short',
		titleKey: 'pageCredentials.status.suspended.title',
		descriptionKey: 'pageCredentials.status.suspended.description',
		isReissuable: false,
	},
	batchExhausted: {
		...THEME_WARN,
		severity: 'medium',
		labelKey: 'pageCredentials.status.batchExhausted.label',
		shortKey: 'pageCredentials.status.batchExhausted.short',
		titleKey: 'pageCredentials.status.batchExhausted.title',
		descriptionKey: 'pageCredentials.status.batchExhausted.description',
		isReissuable: true,
	},
	reissueFailed: {
		...THEME_WARN,
		severity: 'low',
		labelKey: 'Reissue soon',
		shortKey: 'Keep your credential usable',
		titleKey: 'Action needed to keep using this credential',
		descriptionKey: 'This credential is running low or expiring soon, and the wallet couldn\'t reissue it automatically. Reissue it by pressing the button below.',
		isReissuable: true,
	},
	reissueSoon: {
		...THEME_WARN,
		severity: 'low',
		labelKey: 'Reissue soon',
		shortKey: 'Keep your credential usable',
		titleKey: 'Action needed to keep using this credential',
		descriptionKey: 'This credential is running low or expiring soon. Reissue it by pressing the button below.',
		isReissuable: true,
	}
} satisfies Record<string, CredentialStatus>;

/**
 * Statuses that apply to a credential, most severe first.
 */
export function getCredentialStatuses(
	vcEntity?: ExtendedVcEntity,
	notice?: ReissueNotice,
): CredentialStatus[] {
	const statuses: CredentialStatus[] = [];
	if (vcEntity?.isExpired) statuses.push(CREDENTIAL_STATUSES.expired);
	if (vcEntity?.status === TokenStatus.INVALID || vcEntity?.status === TokenStatus.REJECTED) {
		statuses.push(CREDENTIAL_STATUSES.invalid);
	}
	if (vcEntity?.status === TokenStatus.SUSPENDED) statuses.push(CREDENTIAL_STATUSES.suspended);
	if (vcEntity?.isBatchExhausted) statuses.push(CREDENTIAL_STATUSES.batchExhausted);

	// Notices are less severe, and only apply if not expired or batch exhausted.
	if (!(vcEntity?.isExpired || vcEntity?.isBatchExhausted))  {
		switch (notice) {
			case ReissueNotice.REISSUE_FAILED:
				statuses.push(CREDENTIAL_STATUSES.reissueFailed);
				break;
			case ReissueNotice.HARDWARE_BOUND:
			case ReissueNotice.NO_REFRESH_TOKEN:
				statuses.push(CREDENTIAL_STATUSES.reissueSoon);
				break;
		}
	}

	return statuses;
}
