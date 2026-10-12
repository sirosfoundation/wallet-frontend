// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCredentialName } from '@/hooks/useCredentialName';
import i18n from '@/i18n';
import CredentialImage from './CredentialImage';

const CredentialSlideCard = ({ vcEntity, isActive, latestCredentials, onClick, fixedRatio }) => {
	const { t } = useTranslation();

	const credentialName = useCredentialName(
		vcEntity?.parsedCredential?.metadata?.credential?.name,
		vcEntity?.batchId,
		[i18n.language],
	);

	return (
		// biome-ignore lint/a11y/useButtonType: baseline: pre-existing debt. should be fixed
		<button
			id={`credential-slide-${vcEntity.batchId}`}
			className={`relative rounded-xl w-full transition-shadow shadow-md hover:shadow-lg cursor-pointer ${
				latestCredentials.has(vcEntity.batchId) ? 'fade-in' : ''
			}`}
			onClick={() => onClick(vcEntity)}
			aria-label={credentialName ?? ''}
			tabIndex={isActive ? 0 : -1}
			title={t('pageCredentials.credentialFullScreenTitle', {
				friendlyName: credentialName,
			})}
		>
			<CredentialImage
				vcEntity={vcEntity}
				vcEntityInstances={vcEntity.instances}
				showRibbon={isActive}
				parsedCredential={vcEntity.parsedCredential}
				className={`w-full h-full object-cover rounded-xl ${
					latestCredentials.has(vcEntity.batchId) ? 'highlight-filter' : ''
				}`}
				fixedRatio={fixedRatio}
			/>
		</button>
	);
};

export default CredentialSlideCard;
