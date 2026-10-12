// External libraries

import { ArrowLeft } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
// Components
import HistoryDetailContent from '@/components/History/HistoryDetailContent';
import { H1 } from '@/components/Shared/Heading';
// Contexts
import SessionContext from '@/context/SessionContext';
// Hooks
import useFetchPresentations from '@/hooks/useFetchPresentations';
import { logger } from '@/logger';

const HistoryDetail = () => {
	const { transactionId } = useParams();
	const { keystore } = useContext(SessionContext);
	const history = useFetchPresentations(keystore, null, transactionId);
	const navigate = useNavigate();

	// a history item can have more than one presentations (a history item is a transaction)
	const [selectedHistoryItem, setSelectedHistoryItem] = useState([]);
	const { t } = useTranslation();

	logger.debug('history', history);

	useEffect(() => {
		if (transactionId && history && Object.keys(history).length > 0) {
			setSelectedHistoryItem(Object.values(history)[0]);
		}
	}, [history, transactionId]);

	return (
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		<>
			<div className="px-6 sm:px-12 w-full">
				<div className="flex">
					{/** biome-ignore lint/a11y/useButtonType: baseline: pre-existing debt. should be fixed */}
					<button
						id="go-previous"
						onClick={() => navigate(-1)}
						className="mr-2 mb-2"
						aria-label="Go back to the previous page"
					>
						<ArrowLeft size={20} className="text-2xl text-lm-gray-900 dark:text-dm-gray-100" />
					</button>
					<H1 heading={t('pageHistory.presentationDetails.title')} hr={false} />
				</div>
				{selectedHistoryItem.length > 0 && (
					<HistoryDetailContent historyItem={selectedHistoryItem} />
				)}
			</div>
		</>
	);
};

export default HistoryDetail;
