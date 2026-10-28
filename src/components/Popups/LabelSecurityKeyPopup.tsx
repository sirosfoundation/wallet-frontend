import React, { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import SessionContext from '@/context/SessionContext';
import { logger } from '@/logger';
import Button from '../Buttons/Button';

type Props = {
	isOpen: boolean;
	webauthnCredentialId: string;
	onClose: () => void;
};

const LABEL_MAX_LENGTH = 100;

const LabelSecurityKeyPopup = ({ isOpen, onClose, webauthnCredentialId }: Props) => {
	const { api } = useContext(SessionContext);
	const { t } = useTranslation();
	const [nickname, setNickname] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const trimmed = nickname.trim();

	const onSubmit = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
		event.preventDefault();
		if (!trimmed) return;

		setSubmitting(true);
		setError(null);

		try {
			// Call API to label the security key
			const resp = await api.post(`/user/session/webauthn/credential/${webauthnCredentialId}/rename`, { nickname: trimmed });
			if (resp.status === 204) {
				onClose();
			}
			else {
				logger.error('Failed to label security key', resp.status, resp);
				setError(t('labelSecurityKeyPopup.error'));
			}
		} catch (error) {
			logger.error('Failed to label security key', error);
			setError(t('labelSecurityKeyPopup.error'));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<PopupLayout 
			isOpen={isOpen}
			onClose={onClose}
			padding="p-6"
			shouldCloseOnOverlayClick={false}
			ariaLabelledBy="label-security-key-title"
		>
			<form className="flex flex-col text-center space-y-4"
				onSubmit={onSubmit}
			>
				<h2 className="text-xl font-medium text-lm-gray-900 dark:text-dm-gray-50 mb-3"
					id="label-security-key-title"
				>
					{t('labelSecurityKeyPopup.title')}
				</h2>
				<p className="text-sm text-lm-gray-900 dark:text-dm-gray-100 mb-8">
					{t('labelSecurityKeyPopup.description')}
				</p>
				<input className="w-full px-3 py-2 text-sm bg-lm-gray-100 dark:bg-dm-gray-800 border border-lm-gray-400 dark:border-dm-gray-600 dark:text-white rounded-lg dark:inputDarkModeOverride focus-visible:outline"
					id="label-security-key-input"
					type="text" 
					autoFocus
					value={nickname} 
					maxLength={LABEL_MAX_LENGTH} 
					placeholder={t('labelSecurityKeyPopup.placeholder')} 
					aria-label={t('labelSecurityKeyPopup.inputAriaLabel')} 
					onChange={(e) => setNickname(e.target.value)} 
					disabled={submitting}
				/>
				{error && <p className="text-sm text-lm-red dark:text-dm-red mt-2">{error}</p>}
				<div className="flex flex-col gap-3 mt-6">
					<Button 
						id="confirm-label-security-key" 
						type="submit" 
						variant="primary" 
						additionalClassName="w-full" 
						disabled={submitting || !trimmed}
					>
						{t('labelSecurityKeyPopup.confirm')}
					</Button>
					<Button 
						id="skip-label-security-key" 
						type="button" variant="outline" 
						additionalClassName="w-full" 
						onClick={onClose} 
						disabled={submitting}
					>
						{t('labelSecurityKeyPopup.skip')}
					</Button>
				</div>
			</form>
		</PopupLayout>
		
	);
};

export default LabelSecurityKeyPopup;