import { ExtendedVcEntity } from '@/context/CredentialsContext';
import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { getCredentialStatuses } from './credential-status';
import { useOpenIdReissuaNotice } from '@/hooks/useOpenIdReissueNotice';

export type CredentialImageStatusOverlayProps = {
	vcEntity: ExtendedVcEntity;
}

export const CredentialImageStatusOverlay: FC<CredentialImageStatusOverlayProps> = ({
	vcEntity,
}) => {
	const { t } = useTranslation();
	const { getNotice } = useOpenIdReissuaNotice();

	const notice = getNotice(vcEntity.batchId);
	const [status] = getCredentialStatuses(vcEntity, notice);
	if (!status) return null;

	const { icon: Icon, badgeClassName, labelKey, shortKey, severity } = status;

	const rootClassList = {
		low: '',
		medium: 'bg-black/25 backdrop-blur-[2px]',
		high: 'bg-black/50 backdrop-blur-[2px] backdrop-grayscale',
	};

	const pillClassList = {
		low: 'px-2 rounded-lg absolute -top-1.5 -right-1.5',
		medium: 'px-4 rounded-full ',
		high: 'px-4 rounded-full',
	}

	return (
		<div
			className={`
				absolute top-0 left-0 w-full h-full p-4
				flex items-center justify-center flex-col gap-2
				rounded-lg text-sm font-bold
				${rootClassList[severity]}
			`}
		>
			<p
				className={`
					py-1 flex justify-center items-center
					bg-lm-gray-200 dark:bg-dm-gray-800
					border-2 ${badgeClassName}
					${pillClassList[severity]}
				`}
			>
				<Icon size={18} className="inline-block mr-1" />
				{t(labelKey)}
			</p>
			{severity !== 'low' && (
				<p className="text-white max-w-75">
					{t(shortKey)}
				</p>
			)}
		</div>
	);
};
