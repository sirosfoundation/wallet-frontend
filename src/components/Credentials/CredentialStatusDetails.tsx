import { FC } from 'react';
import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';

export type CredentialStatusDetailsProps = {
	vcEntity: ExtendedVcEntity;
};

export type CredentialStatus = {
	icon: FC;
	className: string;
	iconClassName: string;
	title: string;
	description: string;
	isReissuable: boolean;
}

const STATUS_MAP = {
	expired: {
		icon: CircleXIcon,
		className: 'border-lm-red dark:border-dm-red bg-lm-red-bg/10 dark:bg-dm-red-bg/10',
		iconClassName: 'text-lm-red dark:text-dm-red',
		title: 'Credential expired',
		description: 'This credential has expired and requires reissuance.',
		isReissuable: true,
	},
	batchExhausted: {
		icon: TriangleAlertIcon,
		className: 'border-lm-orange dark:border-dm-orange bg-lm-orange-bg/10 dark:bg-dm-orange-bg/10',
		iconClassName: 'text-lm-orange dark:text-dm-orange',
		title: 'Depleted',
		description: 'This credential is depleted and needs to be reissued before it can be used again.',
		isReissuable: true,
	},
}

export const CredentialStatusDetails: FC<CredentialStatusDetailsProps> = ({
	vcEntity,
}) => {
	const statuses = (() => {
		const set = new Set<typeof STATUS_MAP[keyof typeof STATUS_MAP]>();
		if (vcEntity?.isExpired) set.add(STATUS_MAP.expired);
		if (vcEntity?.isBatchExhausted) set.add(STATUS_MAP.batchExhausted);

		return set;
	})();

	if (!statuses.size) return null;

	return statuses.values().map((status) => {
		const { icon: Icon, className, iconClassName, title, description } = status;
		return (
			<section className={`p-3 text-sm rounded-lg flex flex-col gap-3 border ${className}`}>
				<div className="flex gap-2">
					<div className={`grid place-items-center size-8 rounded-full ${iconClassName}`}>
						<Icon size={24} />
					</div>
					<h1 className="font-bold text-lg ">{title}</h1>
				</div>
				<p>{description}</p>
			</section>
		);
	});
};
