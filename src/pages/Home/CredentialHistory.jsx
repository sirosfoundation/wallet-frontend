// External libraries
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

// Contexts
import SessionContext from '@/context/SessionContext';
import CredentialLayout from '../../components/Credentials/CredentialLayout';

// Components
import HistoryList from '../../components/History/HistoryList';
// Hooks
import useFetchPresentations from '../../hooks/useFetchPresentations';

const CredentialHistory = () => {
	const { batchId } = useParams();
	const { keystore } = useContext(SessionContext);
	const history = useFetchPresentations(keystore, batchId, null);
	const { t } = useTranslation();

	return (
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		<>
			<CredentialLayout title={t('pageCredentials.presentationsTitle')}>
				{history.length === 0 ? (
					<p className="text-lm-gray-800 dark:text-dm-gray-200 mt-4">{t('pageHistory.noFound')}</p>
				) : (
					<HistoryList batchId={batchId} history={history} />
				)}
			</CredentialLayout>
		</>
	);
};

export default CredentialHistory;
