import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Button from '../Buttons/Button';

type Props = {
	inProgress: boolean;
	needPrfRetry: boolean;
	prfRetryAccepted: boolean;
	onPrfAnswer: (accept: boolean) => void;
	onCancel: () => void;
	authOnceMoreMessage: string;
	showTryAgain?: boolean;
};

export default function PasskeyProgress({ inProgress, needPrfRetry, prfRetryAccepted, onPrfAnswer, onCancel, authOnceMoreMessage, showTryAgain }: Props) {
	const { t } = useTranslation();

	if (needPrfRetry) {
		return (
			<div className="text-center">
				{prfRetryAccepted
					? <p className="dark:text-white pb-3">{t('registerPasskey.messageInteract')}</p>
					: <>
						<h3 className="text-2xl mt-4 mb-2 font-bold text-lm-gray-900 dark:text-white">{t('registerPasskey.messageDone')}</h3>
						<p className="dark:text-white pb-3">{authOnceMoreMessage}</p>
					</>}
				<div className="flex justify-center gap-4">
					<Button id="cancel-prf-loginsignup" onClick={() => onPrfAnswer(false)}>{t('common.cancel')}</Button>
					<Button id="continue-prf-loginsignup" onClick={() => onPrfAnswer(true)} variant="primary" disabled={prfRetryAccepted}>
						{t('common.continue')}
					</Button>
				</div>
			</div>
		);
	}

	if (showTryAgain && !inProgress) {
		return (
			<div className="text-center">
				<p className="dark:text-white pb-3">
					<Trans i18nKey="registerPasskey.messageErrorTryAgain" components={{ br: <br /> }} />
				</p>
				<div className="flex justify-center gap-4">
					<Button id="cancel-prf-loginsignup" onClick={onCancel}>{t('common.cancel')}</Button>
					<Button id="try-again-prf-loginsignup" type="submit" variant="secondary">{t('common.tryAgain')}</Button>
				</div>
			</div>
		);
	}

	return (
		<>
			<p className="dark:text-white pb-3">{t('registerPasskey.messageInteract')}</p>
			<Button id="cancel-in-progress-prf-loginsignup" onClick={onCancel} additionalClassName="w-full">
				{t('common.cancel')}
			</Button>
		</>
	);
}
