import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { getCredentialStatuses } from './credential-status';
import Button from '../Buttons/Button';
import { useNavigate } from 'react-router';
import { useTenant } from '@/context/TenantContext';

export type CredentialStatusDetailsProps = {
	vcEntity: ExtendedVcEntity;
};

export const CredentialStatusDetails: FC<CredentialStatusDetailsProps> = ({
	vcEntity,
}) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	const statuses = getCredentialStatuses(vcEntity);
	if (!statuses.length) return null;

	const handleReissue = () => {
		navigate(
			buildPath('cb'),
			{
				state: {
					reissueBatchId: vcEntity.batchId,
				},
			},
		);
	};

	return (
		<>
			{statuses.map(({ icon: Icon, panelClassName, iconClassName, titleKey, descriptionKey, isReissuable }) => (
				<section key={titleKey} className={`p-3 text-sm rounded-lg flex flex-col gap-3 border ${panelClassName}`}>
					<div className="flex gap-2">
						<div className={`grid place-items-center size-8 rounded-full ${iconClassName}`}>
							<Icon size={24} />
						</div>
						<h1 className="font-bold text-lg ">{t(titleKey)}</h1>
					</div>
					<p>{t(descriptionKey)}</p>
					{isReissuable && (
						<div className="mt-2">
							<Button variant="outline" onClick={handleReissue}>Reissue</Button>
						</div>
					)}
				</section>
			))}
		</>
	);
};
