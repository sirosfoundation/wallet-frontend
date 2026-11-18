import { ExtendedVcEntity } from '@/context/CredentialsContext';
import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { getCredentialStatuses } from './credential-status';

export type CredentialImageStatusOverlayProps = {
	vcEntity: ExtendedVcEntity;
}

export const CredentialImageStatusOverlay: FC<CredentialImageStatusOverlayProps> = ({
	vcEntity,
}) => {
	const { t } = useTranslation();

	const [status] = getCredentialStatuses(vcEntity);
	if (!status) return null;

	const { icon: Icon, badgeClassName, labelKey, shortKey } = status;

	return (
		<div
			className="
				absolute top-0 left-0 w-full h-full p-4
				flex items-center justify-center flex-col gap-2
				bg-black/50 backdrop-blur-[2px] backdrop-grayscale rounded-lg
				text-sm font-bold
			"
		>
			<p
				className={`
					py-1 px-4 flex justify-center items-center rounded-full
					bg-lm-gray-200 dark:bg-dm-gray-800
					border-2 ${badgeClassName}
				`}
			>
				<Icon size={18} className="inline-block mr-1" />
				{t(labelKey)}
			</p>
			<p className="text-white max-w-75">
				{t(shortKey)}
			</p>
		</div>
	);
};
