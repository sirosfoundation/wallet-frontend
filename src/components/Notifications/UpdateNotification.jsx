import { Bell, X } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StatusContext from '@/context/StatusContext';
import Button from '../Buttons/Button';

const UpdateNotification = () => {
	const { updateAvailable } = useContext(StatusContext);
	const [visible, setVisible] = useState(updateAvailable);
	const { t } = useTranslation();

	const handleReload = () => {
		window.location.reload();
	};

	const handleClose = () => {
		setVisible(false);
	};

	if (!visible) return null;

	return (
		<div className="fixed right-4 bottom-4 sm:top-4 sm:bottom-auto bg-lm-green dark:bg-dm-green z-50 text-white dark:text-lm-gray-900 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 space-x-2 animate-slide-in-up sm:animate-slide-in-down">
			<Bell size={22} className="text-inherit" />
			{t('updateNotification.description')}
			<Button id="reload-update-notification" variant="outline" onClick={handleReload}>
				{t('common.refresh')}
			</Button>
			{/** biome-ignore lint/a11y/useButtonType: baseline: pre-existing debt. should be fixed */}
			<button
				id="close-update-notification"
				className="ml-2 text-inherit p-2 rounded hover:bg-dm-green-bg dark:hover:bg-lm-green-bg"
				onClick={handleClose}
			>
				<X />
			</button>
		</div>
	);
};

export default UpdateNotification;
