import React from 'react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import Button from '../Buttons/Button';
import { CircleAlert } from 'lucide-react';

export interface IssuanceWarning {
	code: string;
}

interface IssuanceWarningPopupProps {
	isOpen: boolean;
	warnings: IssuanceWarning[];
	onConfirm: () => void;
	onCancel: () => void;
}

const IssuanceWarningPopup: React.FC<IssuanceWarningPopupProps> = ({
	isOpen,
	warnings,
	onConfirm,
	onCancel,
}) => {
	const { t } = useTranslation();

	return (
		<PopupLayout isOpen={isOpen} onClose={onCancel}>
			<div className="flex items-start justify-between mb-2">
				<h2 className="flex items-center text-lg font-bold text-lm-gray-900 dark:text-dm-gray-50">
					<div className="inline p-1 rounded-full mr-1 bg-lm-orange dark:bg-dm-orange text-white">
						<CircleAlert size={20} />
					</div>
					{t('issuanceWarningPopup.title')}
				</h2>
			</div>
			<hr className="mb-2 border-t border-lm-gray-500 dark:border-dm-gray-500" />

			<p className="mt-4 text-sm text-lm-gray-800 dark:text-dm-gray-200">
				{t('issuanceWarningPopup.description')}
			</p>

			<ul className="mt-3 mb-2 space-y-2">
				{warnings.map((warning, index) => (
					<li
						key={index}
						className="flex items-start gap-2 p-2 rounded-md bg-lm-gray-200 dark:bg-dm-gray-800"
					>
						<CircleAlert
							size={16}
							className="mt-0.5 shrink-0 text-lm-orange dark:text-dm-orange"
						/>
						<span className="text-sm font-medium text-lm-gray-900 dark:text-dm-gray-100">
							{t(`issuanceWarningPopup.codes.${warning.code}`, warning.code)}
						</span>
					</li>
				))}
			</ul>

			<div className="flex justify-end space-x-2 pt-4">
				<Button id="cancel-issuance-warning" onClick={onCancel}>
					{t('common.cancel')}
				</Button>
				<Button
					id="confirm-issuance-warning"
					variant="primary"
					onClick={onConfirm}
				>
					{t('common.accept')}
				</Button>
			</div>
		</PopupLayout>
	);
};

export default IssuanceWarningPopup;
