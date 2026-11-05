import React, { type FC, useId } from 'react';
import { AppWindowIcon, SquareArrowRightEnterIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import Button from '../Buttons/Button';

export type TakeOverTabPopupProps = { onTakeOver: () => void };

export const TakeOverTabPopup: FC<TakeOverTabPopupProps> = ({ onTakeOver }) => {
	const { t } = useTranslation();
	const headingId = useId();

	return (
		<PopupLayout isOpen={true} ariaLabelledBy={headingId}>
			<div className="flex items-start mb-2 gap-2">
				<AppWindowIcon />
				<h2 id={headingId} className={`text-lg font-bold flex items-center`}>
					{t('takeOverTabPopup.title')}
				</h2>
			</div>
			<p className="mb-6">{t('takeOverTabPopup.description')}</p>
			<Button
				onClick={onTakeOver}
				variant="primary"
				size="lg"
				additionalClassName="w-full"
			>
				<SquareArrowRightEnterIcon /> {t('takeOverTabPopup.takeOver')}
			</Button>
		</PopupLayout>
	);
};
