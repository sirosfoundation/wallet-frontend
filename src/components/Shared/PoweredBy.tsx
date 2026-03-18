import { Trans, useTranslation } from 'react-i18next';

interface PoweredByProps {
	className?: string;
	linkClassName?: string;
}

const PoweredBy = ({ className, linkClassName }: PoweredByProps) => {
	const { t } = useTranslation();

	return (
		<p className={className}>
			<Trans
				i18nKey="sidebar.poweredBy"
				components={{
					docLinkWalletGithub: (
						<a
							href="https://developers.siros.org/sirosid"
							rel="noreferrer"
							target="_blank"
							className={linkClassName}
							aria-label={t('sidebar.poweredByAriaLabel')}
						/>
					)
				}}
			/>
		</p>
	);
};

export default PoweredBy;
