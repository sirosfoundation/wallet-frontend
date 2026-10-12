// External libraries
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';

// Context
import SessionContext from '@/context/SessionContext';
import HistoryList from '../../components/History/HistoryList';

// Components
import { H1 } from '../../components/Shared/Heading';
import PageDescription from '../../components/Shared/PageDescription';
// Hooks
import useFetchPresentations from '../../hooks/useFetchPresentations';

const History = () => {
	const { keystore } = useContext(SessionContext);
	const history = useFetchPresentations(keystore);

	const { t } = useTranslation();

	return (
		<div className="px-6 sm:px-12 w-full">
			<H1 heading={t('common.navItemHistory')} />
			<PageDescription description={t('pageHistory.description')} />

			{history.length === 0 ? (
				<p className="text-lm-gray-800 dark:text-dm-gray-200 mt-4">{t('pageHistory.noFound')}</p>
			) : (
				<HistoryList history={history} />
			)}
		</div>
	);
};

export default History;
