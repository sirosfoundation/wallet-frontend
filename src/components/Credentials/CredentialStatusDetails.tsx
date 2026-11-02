import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { getCredentialStatuses } from './credential-status';

export type CredentialStatusDetailsProps = {
	vcEntity: ExtendedVcEntity;
};

export const CredentialStatusDetails: FC<CredentialStatusDetailsProps> = ({
	vcEntity,
}) => {
	const { t } = useTranslation();

	const statuses = getCredentialStatuses(vcEntity);
	if (!statuses.length) return null;

	return (
		<>
			{statuses.map(({ icon: Icon, panelClassName, iconClassName, titleKey, descriptionKey }) => (
				<section key={titleKey} className={`p-3 text-sm rounded-lg flex flex-col gap-3 border ${panelClassName}`}>
					<div className="flex gap-2">
						<div className={`grid place-items-center size-8 rounded-full ${iconClassName}`}>
							<Icon size={24} />
						</div>
						<h1 className="font-bold text-lg ">{t(titleKey)}</h1>
					</div>
					<p>{t(descriptionKey)}</p>
				</section>
			))}
		</>
	);
};
