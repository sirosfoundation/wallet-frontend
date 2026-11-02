import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeft, SquareAsterisk } from 'lucide-react';
import { DoubleUsbStickDotIcon, UsbStickDotIcon } from '@/components/Shared/CustomIcons';
import Button from '@/components/Buttons/Button';
import YubiKeyImage from '@/assets/images/yubikey.png';

type Props = {
	onBack: () => void;
	onCancel: () => void;
	onContinue: () => void;
};

const STEPS = [
	{ Icons: [UsbStickDotIcon], key: 'getKey' },
	{ Icons: [SquareAsterisk], key: 'pin' },
	{ Icons: [DoubleUsbStickDotIcon], key: 'secondKey' },
];

export default function GetReadyInfo({ onBack, onCancel, onContinue }: Props) {
	const { t } = useTranslation();
	const card = 'p-4 bg-white dark:bg-dm-gray-900 rounded-lg border border-lm-gray-400 dark:border-dm-gray-600';

	return (
		<section className="flex items-center bg-lm-gray-100 dark:bg-dm-gray-900 min-h-dvh">
			<div className="mx-auto w-full sm:max-w-md px-4 py-6 space-y-5 text-lm-gray-900 dark:text-white -translate-y-2">

				{/* Back arrow and Title */}
				<div className="border-b border-lm-gray-400 dark:border-dm-gray-600 pb-2">
					<Button id="getReady-back-loginsignup" variant="invisible" square additionalClassName="-ml-3" onClick={onBack} ariaLabel={t('getReady.back')}>
						<ArrowLeft size={20} />
					</Button>
					<h1 className="mt-1 text-xl font-bold">{t('getReady.title')}</h1>
				</div>

				{/* Instruction Steps */}
				<div className={card}>
					<ul className="space-y-4">
						{STEPS.map(({ Icons, key }) => (
							<li key={key} className="flex gap-3">
								<div className="size-10 shrink-0 mt-1 flex items-center justify-center gap-1 rounded-sm bg-lm-gray-200 border border-lm-gray-400 dark:bg-dm-gray-800 dark:border-dm-gray-600">
									{Icons.map((Icon, i) => (
										<Icon key={`${key}-${i}`} size={Icons.length > 1 ? 16 : 20} className="text-primary"/>
									))}
								</div>
								<div className="text-sm">
									<p className="font-bold">{t(`getReady.steps.${key}.title`)}</p>
									<p>{t(`getReady.steps.${key}.text`)}</p>
								</div>
							</li>
							))}
					</ul>
					<p className="mt-4 text-xs ml-[52px]">
						<Trans i18nKey="getReady.noKey" components={{ u: <span className="underline" /> }} />
					</p>
				</div>

				{/* About Security Keys Card */}
				<div className={`${card} text-sm`}>
					<figure className="float-right ml-2 p-3 text-center">
						<img src={YubiKeyImage} alt="" className="w-22" />
						<figcaption className="mt-1 text-[8px] text-lm-gray-600 dark:text-dm-gray-400">
							© Yubico
						</figcaption>
					</figure>
					<h2 className="font-bold mb-3">{t('getReady.about.title')}</h2>
					<p>{t('getReady.about.text')}</p>
					<p className="mt-4 clear-both">
						<Trans i18nKey="getReady.about.compatible" components={{ u: <span className="underline" /> }} />
					</p>
				</div>

				{/* Tip Card */}
				<div className={`${card} flex items-center gap-4 text-sm`}>
					<div className="size-20 shrink-0 flex items-center justify-center rounded-lg bg-lm-gray-200 dark:bg-dm-gray-800 border border-lm-gray-400 dark:bg-dm-gray-800 dark:border-dm-gray-600">
						<UsbStickDotIcon size={36} className="text-primary"/>
					</div>
					<p>
						<Trans i18nKey="getReady.tip" components={{ b: <span className="font-bold" /> }} />
					</p>
				</div>

				{/* Buttons */}
				<div className="space-y-3">
					<Button id="getReady-continue-loginsignup" variant="primary" additionalClassName="w-full" onClick={onContinue}>
						{t('common.continue')}
					</Button>
					<Button id="getReady-cancel-loginsignup" variant="outline" additionalClassName="w-full" onClick={onCancel}>
						{t('common.cancel')}
					</Button>
				</div>

			</div>
		</section>
	);
}
