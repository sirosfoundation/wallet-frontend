import { FC } from 'react';
import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import Button from '../Buttons/Button';

export type CredentialStatusDetailsProps = {
	vcEntity: ExtendedVcEntity;
};

const STATUS_MAP = {
	expired: {
		icon: CircleXIcon,
		color: 'red',
		title: 'Credential expired',
		description: 'This credential has expired and requires reissuance.',
	},
	batchExhausted: {
		icon: TriangleAlertIcon,
		color: 'orange',
		title: 'Batch exhausted',
		description: 'The batch for this credential has been exhausted and requires reissuance.',
	},
}

export const CredentialStatusDetails: FC<CredentialStatusDetailsProps> = ({
	vcEntity,
}) => {
	const status = (() => {
		if (vcEntity?.isExpired) return STATUS_MAP.expired;
		if (vcEntity?.isBatchExhausted) return STATUS_MAP.batchExhausted;
		return null;
	})();

	if (!status) return null;

	const { icon: Icon, color, title, description } = status;

	return (
		<section className={`p-3 text-sm rounded-lg flex flex-col gap-3 border border-lm-${color} dark:border-dm-${color} bg-lm-${color}-bg/10 dark:bg-dm-${color}-bg/10`}>
			<div className="flex gap-2">
				<div className={`grid place-items-center size-8 rounded-full text-lm-${color}`}>
					<Icon size={24} />
				</div>
				<h1 className="font-bold text-lg ">{title}</h1>
			</div>
			<p>
				{description}
			</p>
			{/* <div>
				<Button variant="outline">
					Reissue Credential
				</Button>
			</div> */}
		</section>
	);
};
