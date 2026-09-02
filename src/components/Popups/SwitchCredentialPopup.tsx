import React, { type FC, type Dispatch, type SetStateAction, useId } from 'react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import { PresentCredentialsMatch } from '../flows/PresentCredentialsFlow';
import Button from '../Buttons/Button';
import { CredentialTypeCard } from '../Credentials/CredentialTypeCard';

export type SwitchCredentialPopupState = {
	id: string;
	selected: PresentCredentialsMatch;
	alternatives: PresentCredentialsMatch[];
};

type SwitchCredentialPopupProps = {
	switchCredentialState: SwitchCredentialPopupState | null;
	setSwitchCredentialState: Dispatch<SetStateAction<SwitchCredentialPopupState | null>>;
	selectCredential: (batchId: number) => void;
};

export const SwitchCredentialPopup: FC<SwitchCredentialPopupProps> = ({
	switchCredentialState,
	setSwitchCredentialState,
	selectCredential,
}) => {
	const { t } = useTranslation();
	const headingId = useId();

	if (!switchCredentialState) return null;

	const { selected, alternatives } = switchCredentialState;

	return (
		<PopupLayout
			isOpen={switchCredentialState !== null}
			onClose={() => setSwitchCredentialState(null)}
			ariaLabelledBy={headingId}
		>
			<div className="flex items-start justify-between mb-2">
				<h2 id={headingId} className={`text-lg font-bold flex items-center`}>
					{t('switchCredentialPopup.title')}
				</h2>
				<Button
					square={true}
					variant="invisible"
					aria-label={t('switchCredentialPopup.close')}
					onClick={() => setSwitchCredentialState(null)}
				>
					<svg
						className="w-3 h-3"
						aria-hidden="true"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 14 14"
					>
						<path
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
						/>
					</svg>
				</Button>
			</div>
			<p className="mb-6">{t('switchCredentialPopup.description')}</p>
			<h3 className="mb-2 font-semibold">{t('switchCredentialPopup.selectedCredential')}</h3>
			<CredentialTypeCard display={selected.display} />
			<hr className="my-2 border-t border-lm-gray-400 dark:border-dm-gray-600" />
			<h3 className="mt-4 mb-2 font-semibold">
				{t('switchCredentialPopup.alternativeCredentials')}
			</h3>
			<ul className="space-y-2">
				{alternatives.map(({ batchId, display }) => (
					<li key={batchId}>
						<CredentialTypeCard
							display={display}
							onClick={() => {
								selectCredential(batchId);
								setSwitchCredentialState(null);
							}}
						/>
					</li>
				))}
			</ul>
		</PopupLayout>
	);
};
