import React from "react";
import Logo from "@/components/Logo/Logo";
/*import { useNavigate } from "react-router";*/
import { useTranslation } from "react-i18next";
import Button from "@/components/Buttons/Button";
import { APP_VERSION } from "@/config";
import { AlertCircle } from "lucide-react";

const ReportIssueEmail = 'support@siros.org';

type GlobalErrorScreenProps = {
	error?: Error;
};

const GlobalErrorScreen = ({error}: GlobalErrorScreenProps) => {
	const {t} = useTranslation()

	const handleReportIssue = () => {
		const subject = `Wallet crash report${error?.name ? `: ${error.name}` : ''}`;
		const body = [
		'Please describe what happened:',
		'',
		'',
		'',
		'',
		'--- Diagnostic information ---',
		`Time Stamp: ${new Date().toISOString()}`,
		`URL: ${window.location.href}`,
		`App Version: ${APP_VERSION ?? 'unknown'}`,
		`Browser: ${navigator.userAgent}`
	].join('\n')

		window.location.href = `mailto:${ReportIssueEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	}

	return (
		<section>
			<div className="flex flex-col items-center px-6 py-8 mx-auto min-h-dvh">
				<div className="flex items-center mt-2 gap-2">
					<Logo imgClassName="w-10" clickable={false}/>
					<span className="text-xl font-semibold text-lm-gray-900 dark:text-dm-gray-100">
						SIROS WALLET ID
					</span>
				</div>
				<div className="flex-1 flex flex-col items-center justify-center w-full">
					<div className="w-full rounded-lg shadow md:mt-0 sm:max-w-md xl:p-0">
						<div className= "p-6 space-y-6 md:space-y-6 sm:p-8">
							<div className="flex justify-center">
								<AlertCircle className="text-lm-red dark:text-dm-red" size={64}/>
							</div>
							<h1 className="text-2xl font-bold leading-tight tracking-tight text-lm-gray-900 md:text-4xl text-center dark:text-dm-gray-100">
									{t('globalError.title')}
							</h1>
							<p className="text-center">
								{t('globalError.message')}
							</p>
							<div className="pt-6">
								<Button onClick={handleReportIssue} variant="outline" additionalClassName="w-full">
								{t('globalError.reportIssueButton')}
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
};

export default GlobalErrorScreen;
