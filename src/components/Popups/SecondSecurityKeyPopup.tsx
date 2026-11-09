import React, { SubmitEvent, useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import StatusContext from '@/context/StatusContext';
import { useAddSecurityKey } from '@/hooks/useAddSecurityKey';
import PopupLayout from '@/components/Popups/PopupLayout';
import Button from '@/components/Buttons/Button';
import PasskeyProgress from '@/components/Auth/PasskeyProgress';

const NICKNAME_MAX_LENGTH = 100;
type Props = {
	onDone: () => void;
	onInlineChange?: (inline: boolean) => void;
};

const SecondSecurityKeyPopup = ({ onDone, onInlineChange }: Props) => {
	const { t } = useTranslation();
	const { isOnline } = useContext(StatusContext);
	const addKey = useAddSecurityKey();
	const [nickname, setNickname] = useState('');
	const [finishing, setFinishing] = useState(false);
	const [showLabel, setShowLabel] = useState(false);
	const resolveLabel = useRef<((label: string) => void) | null>(null);
	const finishStarted = useRef(false);

	useEffect(() => {
		if (!isOnline) onDone();
	}, [isOnline, onDone]);

	const screen =
		showLabel ? 'label'
		: (addKey.needPrfRetry || addKey.prfRetryAccepted) ? 'prf'
		: addKey.beginData ? 'waiting'
		: 'intro';

	const inline = screen === 'waiting' || screen === 'prf';
	useEffect(() => {
		onInlineChange?.(inline);
	}, [inline, onInlineChange]);

	useEffect(() => () =>
		onInlineChange?.(false), [onInlineChange]);

	const onYes = () => {
		addKey.begin('security-key')
	};

	const askForLabel = useCallback(() => new Promise<string>((resolve) => {
		resolveLabel.current = resolve;
		setShowLabel(true);
	}), []);

	const { pendingCredential, finish } = addKey;

	useEffect(() => {
		if (!pendingCredential || finishStarted.current) return;
		finishStarted.current = true;
		void (async () => {
			try {
				if (await finish(askForLabel))
					onDone();
			} finally {
				finishStarted.current = false;
				setShowLabel(false);
				setFinishing(false);
				setNickname('');
			}
		})();
	}, [pendingCredential, finish, askForLabel, onDone]);

	const onFinish = (label: string) => {
		setFinishing(true);
		resolveLabel.current?.(label);
		resolveLabel.current = null;
	};

	const onSubmitLabel = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		onFinish(nickname.trim());
	};

	if (inline) {
		return (
			<div className="mb-4">
				<PasskeyProgress
					inProgress={true}
					needPrfRetry={addKey.needPrfRetry}
					prfRetryAccepted={addKey.prfRetryAccepted}
					onPrfAnswer={(accept) => addKey.resolvePrfRetryPrompt(accept)}
					onCancel={addKey.cancel}
					authOnceMoreMessage={t('registerPasskey.authOnceMore')}
				/>
			</div>
		)
	}

	return (
		<PopupLayout
			isOpen={true}
			onClose={screen === 'intro' ? onDone : undefined}
			padding="p-6"
			shouldCloseOnOverlayClick={false}
			ariaLabelledBy="second-security-key-title"
		>
			{screen === 'intro' && (
				<div className="flex flex-col text-center">
					<h2 id="second-security-key-title" className="text-xl font-medium text-lm-gray-900 dark:text-dm-gray-50 mb-3">
						{t('secondSecurityKey.title')}
					</h2>
					<p className="text-sm text-lm-gray-900 dark:text-dm-gray-100 mb-6">
						{t('secondSecurityKey.description')}
					</p>
					{addKey.error && (
						<p className="text-sm text-lm-red dark:text-dm-red mb-4">
							{t(`secondSecurityKey.${addKey.error}`)}
						</p>
					)}
					<div className="flex flex-col gap-3">
						<Button
							id="yes-second-security-key"
							variant="primary"
							additionalClassName="w-full"
							onClick={onYes}
							disabled={addKey.isSubmitting}
						>
							{t('secondSecurityKey.yes')}
						</Button>
						<Button
							id="skip-second-security-key"
							variant="outline"
							additionalClassName="w-full"
							onClick={onDone}
							disabled={addKey.isSubmitting}
						>
							{t('secondSecurityKey.skip')}
						</Button>
					</div>
				</div>
			)}

			{screen === 'label' && (
				<form onSubmit={onSubmitLabel} className="flex flex-col text-center">
					<h2 id="second-security-key-title" className="text-xl font-medium text-lm-gray-900 dark:text-dm-gray-50 mb-3">
						{t('secondSecurityKey.labelTitle')}
					</h2>
					<p className="text-sm text-lm-gray-900 dark:text-dm-gray-100 mb-8">
						{t('secondSecurityKey.labelDescription')}
					</p>
					<input
						id="second-security-key-input"
						className="w-full px-3 py-2 text-sm bg-lm-gray-100 dark:bg-dm-gray-800 border border-lm-gray-400 dark:border-dm-gray-600 dark:text-white rounded-lg dark:inputDarkModeOverride"
						type="text"
						value={nickname}
						maxLength={NICKNAME_MAX_LENGTH}
						placeholder={t('secondSecurityKey.labelPlaceholder')}
						aria-label={t('secondSecurityKey.labelInputAriaLabel')}
						onChange={(e) => setNickname(e.target.value)}
						disabled={finishing}
					/>
					<div className="flex flex-col gap-3 mt-6">
						<Button
							id="confirm-label-second-security-key"
							type="submit"
							variant="primary"
							additionalClassName="w-full"
							disabled={finishing || !nickname.trim()}
						>
						{t('secondSecurityKey.confirm')}
						</Button>
						<Button
							id="skip-label-second-security-key"
							type="button"
							variant="outline"
							additionalClassName="w-full"
							onClick={() => onFinish('')}
							disabled={finishing}
						>
							{t('secondSecurityKey.skip')}
						</Button>
					</div>
				</form>
			)}
		</PopupLayout>
	);
};

export default SecondSecurityKeyPopup;
