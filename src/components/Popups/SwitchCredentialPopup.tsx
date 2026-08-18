import React, { type FC, type Dispatch, type SetStateAction, useId } from 'react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import { PresentCredentialsMatch } from '../flows/PresentCredentialsFlow';
import Button from '../Buttons/Button';
import { CredentialTypeCard } from '../Credentials/CredentialTypeCard';

export type SwitchCredentialPopupState = {
	id: string;
	matches: PresentCredentialsMatch[];
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

	const allCredentials = [
		switchCredentialState.selected,
		...switchCredentialState.alternatives,
	];

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
					<svg className="w-3 h-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
						<path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
					</svg>
				</Button>
			</div>
			<p>{t('switchCredentialPopup.description')}</p>
			<ul className="space-y-2 mt-4">
				{allCredentials.map(({ batchId, display: { name, backgroundColor, logo, textColor } }, index) => (
					<li key={batchId}>
						<CredentialTypeCard
							status={index === 0 ? 'selected' : undefined}
							name={name}
							logo={logo}
							backgroundColor={backgroundColor}
							textColor={textColor}
							description={switchCredentialState.id}
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
