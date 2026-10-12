// External libraries
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
// Contexts
import CredentialsContext from '@/context/CredentialsContext';
import CredentialJson from '../../components/Credentials/CredentialJson';

// Components
import CredentialLayout from '../../components/Credentials/CredentialLayout';
// Hooks
import { useVcEntity } from '../../hooks/useVcEntity';

const CredentialDetails = () => {
	const { batchId } = useParams();
	const { t } = useTranslation();

	const { vcEntityList, fetchVcData } = useContext(CredentialsContext);
	const vcEntity = useVcEntity(fetchVcData, vcEntityList, batchId);

	return (
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		<>
			<CredentialLayout title={t('pageCredentials.datasetTitle')}>
				{vcEntity && (
					<CredentialJson parsedCredential={vcEntity?.parsedCredential} textAreaRows="18" />
				)}
			</CredentialLayout>
		</>
	);
};

export default CredentialDetails;
