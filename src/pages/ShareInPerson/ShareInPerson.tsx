import React from 'react';
import { useTranslation } from 'react-i18next';
import { QrCode, SmartphoneNfc } from 'lucide-react';
import { ScanQrIcon } from '@/components/Shared/CustomIcons';
import { logger } from '@/logger';
import { H1 } from '@/components/Shared/Heading';
import OptionCard from '@/components/Shared/OptionCard';

type ShareMethod = 'tap' | 'showQr' | 'scanQr';

const ShareInPerson = () => {
	const { t } = useTranslation();

	const handleTap = () => logger.debug('[ShareInPerson] tap selected');
	const handleShowQr = () => logger.debug('[ShareInPerson] show QR selected');
	const handleScanQr = () => logger.debug('[ShareInPerson] scan QR selected');

	const options: Array<{ key: ShareMethod; icon: React.ComponentType<{ size?: number; className?: string }>; onClick: () => void }> = [
		{ key: 'tap', icon: SmartphoneNfc, onClick: handleTap },
		{ key: 'showQr', icon: QrCode, onClick: handleShowQr },
		{ key: 'scanQr', icon: ScanQrIcon, onClick: handleScanQr },
	];

	return (
		<div className="px-6 sm:px-12 w-full">
			<H1 heading={t('pageShareInPerson.title')} />
			<p className="mt-2 mb-4 text-lm-gray-800 dark:text-dm-gray-200">
				{t('pageShareInPerson.description')}
			</p>
			<ul className="flex flex-col gap-3 max-w-xl">
				{options.map(({ key, icon, onClick }) => (
					<li key={key}>
						<OptionCard
							id={`share-in-person-${key}`}
							icon={icon}
							title={t(`pageShareInPerson.${key}.title`)}
							description={t(`pageShareInPerson.${key}.description`)}
							onClick={onClick}
						/>
					</li>
				))}
			</ul>
		</div>
	);
};

export default ShareInPerson;
