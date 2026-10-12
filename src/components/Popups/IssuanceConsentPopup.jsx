import { TriangleAlert } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useScreenType from '../../hooks/useScreenType';
import Button from '../Buttons/Button';
import PopupLayout from './PopupLayout';

function GenericConsentPopup({
	popupConsentState,
	setPopupConsentState,
	// biome-ignore lint/correctness/noUnusedFunctionParameters: baseline: pre-existing debt. should be fixed
	showConsentPopup,
	// biome-ignore lint/correctness/noUnusedFunctionParameters: baseline: pre-existing debt. should be fixed
	hidePopupConsent,
}) {
	const { t, i18n } = useTranslation();

	const screenType = useScreenType();

	const reinitialize = useCallback(() => {
		setPopupConsentState((current) => ({ ...current, isOpen: false }));
	}, [setPopupConsentState]);

	useEffect(() => {
		// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
		if (popupConsentState?.options) {
		}
	}, [popupConsentState]);

	const consent = () => {
		reinitialize();
		popupConsentState.resolve(true);
	};

	const onClose = () => {
		// setIsOpen(false);
		popupConsentState.resolve(false);
		reinitialize();
		// navigate('/');
	};

	if (!popupConsentState?.isOpen) {
		return null;
	}

	return (
		<PopupLayout
			isOpen={popupConsentState?.isOpen}
			onClose={onClose}
			loading={false}
			fullScreen={screenType !== 'desktop'}
		>
			<div className={`${screenType !== 'desktop' && 'pb-16'}`}>
				<div>
					{popupConsentState?.options?.title ? (
						<h2 className="text-lg font-bold mb-2 text-lm-gray-900 dark:text-dm-gray-100">
							{popupConsentState?.options?.title}
						</h2>
					) : (
						// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
						<></>
					)}
					<hr className="mb-2 border-t border-lm-gray-400 dark:border-dm-gray-600" />
					<p className="text-lm-gray-800 dark:text-dm-gray-200 text-sm mt-3 mb-2">
						{t('issuance.credentialsHaveErrors')}
					</p>
					<ul className="text-sm text-lm-gray-800 dark:text-dm-gray-200 list-disc ml-1 mb-4">
						{popupConsentState?.options?.warnings?.map((warning) => (
							// biome-ignore lint/correctness/useJsxKeyInIterable: baseline: pre-existing debt. should be fixed
							<li className="flex gap-3 items-center">
								<TriangleAlert />
								{i18n.exists(`parsing.${warning.code}`)
									? t(`parsing.${warning.code}`)
									: warning.code}
							</li>
						))}
					</ul>
					<p className="text-lm-gray-800 dark:text-dm-gray-200 text-sm mt-3 mb-2">
						{t('issuance.proceed')}
					</p>
				</div>

				<div
					className={`flex justify-between pt-4 z-10 ${screenType !== 'desktop' && 'fixed bottom-0 left-0 right-0 bg-lm-gray-100 dark:bg-dm-gray-900 flex px-6 pb-6 shadow rounded-t-lg w-auto'}`}
				>
					<Button id="cancel-select-credentials" onClick={onClose} className="mr-2">
						{t('common.cancel')}
					</Button>

					<div className="flex gap-2">
						<Button id="consent" variant="secondary" onClick={consent}>
							{t('common.continue')}
						</Button>
					</div>
				</div>
			</div>
		</PopupLayout>
	);
}

export default GenericConsentPopup;
