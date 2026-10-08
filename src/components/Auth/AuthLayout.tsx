import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import * as config from '../../config';
import Logo from '../Logo/Logo';
import PWAInstallPrompt from '../PWAInstall/PWAInstallPrompt';
import useScreenType from '@/hooks/useScreenType';
import PoweredBy from '../Shared/PoweredBy';
import { useStatusContext } from '@/hooks/useStatusContext';
import LanguageSelector from '@/components/LanguageSelector/LanguageSelector';

type AuthLayoutProps = {
	headingKey: string;
	title: React.ReactNode;
	children: React.ReactNode;
	footer?: React.ReactNode;
	belowCard?: React.ReactNode;
	cornerLeft?: React.ReactNode;
};

export default function AuthLayout({ headingKey, children, title, footer, belowCard, cornerLeft }: AuthLayoutProps) {
	const { t } = useTranslation();
	const screenType = useScreenType();
	const { isOnline } = useStatusContext();

	return (
		<section className="bg-lm-gray-100 dark:bg-dm-gray-900 min-h-dvh flex flex-col">
			{config.SHOW_PWA_INSTALL_PROMPT && screenType !== 'desktop' && (
				<PWAInstallPrompt />
			)}

			<div className="grow flex flex-col items-center justify-center px-6 py-8">
				<Logo aClassName='mb-6' imgClassName='w-20' />

				<h1 className="text-3xl mb-8 font-bold leading-tight tracking-tight text-lm-gray-900 text-center dark:text-white">
					<Trans i18nKey={headingKey} components={{ highlight: <span className="text-primary dark:text-brand-light" /> }} />
				</h1>

				<div className="relative w-full sm:max-w-md xl:p-0">
					<div className="relative p-8 bg-white dark:bg-dm-gray-900 rounded-lg border border-lm-gray-400 dark:border-dm-gray-600 bp-8 sm:px-12 space-y-4 md:space-y-6 lg:space-y-8">
						<h1 className="pt-4 text-xl font-bold leading-tight tracking-tight text-lm-gray-900 text-center dark:text-white md:text-2xl">
							{title}
						</h1>
						{cornerLeft && <div className="absolute top-5 left-5">{cornerLeft}</div>}
						<div className="absolute top-5 right-5">
							<LanguageSelector className="min-w-12 text-sm text-lm-gray-900 dark:text-white cursor-pointer bg-white dark:bg-dm-gray-900 appearance-none" />
						</div>
						{isOnline === false && (
							<p className="text-sm text-red-600 dark:text-red-400">
								<Info size={14} className= "text-md inline-block mr-1" />
								{t('loginSignup.messageOffline')}
							</p>
						)}
						{children}
						{footer && <div className="space-y-4">{footer}</div>}
					</div>
					{belowCard}
				</div>

				{config.SHOW_PWA_INSTALL_PROMPT && screenType === 'desktop' && (
					<PWAInstallPrompt />
				)}
			</div>

			<footer className="py-4">
				<PoweredBy
					className="text-sm text-lm-gray-800 dark:text-dm-gray-200 text-center"
					linkClassName="underline font-semibold text-lm-gray-800 dark:text-dm-gray-300"
				/>
				<p className="hidden">v{config.APP_VERSION}</p>
			</footer>
		</section>
	);
}
