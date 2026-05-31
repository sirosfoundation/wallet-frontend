import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ScanFace, ScanSearch, Nfc, IdCard, Sun, Signal, ShieldCheck } from 'lucide-react';
import { H1 } from '@/components/Shared/Heading';
import Button from '@/components/Buttons/Button';

const StepIcon = ({ Icon }) => (
	<div className="flex items-center justify-center h-10 w-10 rounded-lg bg-brand-lighter/20 dark:bg-brand-darker/40 text-primary shrink-0">
		<Icon size={20} />
	</div>
);

const PrerequisiteIcon = ({ Icon }) => (
	<div className="flex items-center justify-center h-12 w-12 rounded-full bg-lm-gray-300 dark:bg-dm-gray-600 text-primary">
		<Icon size={22} />
	</div>
);

const ScanPhysicalID = () => {
	const navigate = useNavigate();
	const { t } = useTranslation();

	const steps = [
		{ icon: ScanFace,   title: t('pageScanPhysicalId.steps.step1.title'), description: t('pageScanPhysicalId.steps.step1.description') },
		{ icon: ScanSearch, title: t('pageScanPhysicalId.steps.step2.title'), description: t('pageScanPhysicalId.steps.step2.description') },
		{ icon: Nfc,        title: t('pageScanPhysicalId.steps.step3.title'), description: t('pageScanPhysicalId.steps.step3.description') },
	];

	const prerequisites = [
		{ icon: IdCard, label: t('pageScanPhysicalId.beforeYouBegin.passportReady') },
		{ icon: Sun,    label: t('pageScanPhysicalId.beforeYouBegin.goodLighting') },
		{ icon: Signal, label: t('pageScanPhysicalId.beforeYouBegin.goodInternet') },
	];

	return (
		<div className="px-6 sm:px-12 w-full pb-8">

			{/* Header */}
			<div className="flex items-center mb-2">
				<button
					onClick={() => navigate(-1)}
					className="mr-2 mb-2 cursor-pointer"
					aria-label={t('pageScanPhysicalId.goBackAriaLabel')}
				>
					<ArrowLeft size={20} className="text-lm-gray-900 dark:text-dm-gray-100" />
				</button>
				<H1 heading={t('pageScanPhysicalId.title')} hr={false} />
			</div>
			<hr className="mb-6 border-t border-lm-gray-400 dark:border-dm-gray-600" />

			{/* Cards: stacked on mobile, 2-column on desktop */}
			<div className="flex flex-col md:grid md:grid-cols-2 md:gap-4">

				{/* Left column */}
				<div className="flex flex-col gap-4">

					{/* Steps */}
					<div className="border border-lm-gray-400 dark:border-dm-gray-600 rounded-xl p-4 bg-lm-gray-50 dark:bg-dm-gray-800">
						{steps.map(({ icon: Icon, title, description }, i) => (
							<div
								key={title}
								className={`flex items-start gap-4${i < steps.length - 1 ? ' mb-4' : ''}`}
							>
								<StepIcon Icon={Icon} />
								<div>
									<p className="font-semibold text-lm-gray-900 dark:text-dm-gray-100">{title}</p>
									<p className="text-sm text-lm-gray-700 dark:text-dm-gray-300">{description}</p>
								</div>
							</div>
						))}
					</div>

					{/* Why face scan — desktop: left column below steps */}
					<div className="hidden md:block border border-lm-gray-400 dark:border-dm-gray-600 rounded-xl p-4 bg-lm-gray-50 dark:bg-dm-gray-800">
						<WhyFaceScan t={t} />
					</div>

				</div>

				{/* Right column */}
				<div className="flex flex-col gap-4 mt-4 md:mt-0">

					{/* Before you begin */}
					<div className="border border-lm-gray-400 dark:border-dm-gray-600 rounded-xl p-4 bg-lm-gray-50 dark:bg-dm-gray-800">
						<p className="font-semibold mb-4 text-lm-gray-900 dark:text-dm-gray-100">
							{t('pageScanPhysicalId.beforeYouBegin.title')}
						</p>
						<div className="grid grid-cols-3 gap-2 text-center">
							{prerequisites.map(({ icon: Icon, label }) => (
								<div key={label} className="flex flex-col items-center gap-2">
									<PrerequisiteIcon Icon={Icon} />
									<p className="text-xs text-lm-gray-900 dark:text-dm-gray-100">{label}</p>
								</div>
							))}
						</div>
					</div>

					{/* Why face scan — mobile: in flow after Before you begin */}
					<div className="md:hidden border border-lm-gray-400 dark:border-dm-gray-600 rounded-xl p-4 bg-lm-gray-50 dark:bg-dm-gray-800">
						<WhyFaceScan t={t} />
					</div>

					{/* Start Scan — desktop: right column bottom */}
					<div className="hidden md:block" data-widget="scan-physical-id-start">
						<StartScanButton t={t} />
					</div>

				</div>
			</div>

			{/* Start Scan — mobile: full-width at bottom */}
			<div className="md:hidden mt-6" data-widget="scan-physical-id-start">
				<StartScanButton t={t} />
			</div>

		</div>
	);
};

const WhyFaceScan = ({ t }) => (
	<div className="flex items-start gap-4">
		<div className="flex-1">
			<p className="font-semibold mb-2 text-lm-gray-900 dark:text-dm-gray-100">
				{t('pageScanPhysicalId.whyFaceScan.title')}
			</p>
			<p className="text-sm text-lm-gray-700 dark:text-dm-gray-300">
				{t('pageScanPhysicalId.whyFaceScan.description')}
			</p>
		</div>
		<div className="flex items-center justify-center h-14 w-14 rounded-lg bg-lm-gray-300 dark:bg-dm-gray-600 text-primary shrink-0">
			<ShieldCheck size={28} />
		</div>
	</div>
);

const StartScanButton = ({ t }) => (
	<Button variant="primary" additionalClassName="w-full" size="lg">
		{t('pageScanPhysicalId.startScan')}
	</Button>
);

export default ScanPhysicalID;
