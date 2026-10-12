import { useTranslation } from 'react-i18next';
import { usePolicyLinks } from '@/hooks/usePolicyLinks';

const PolicyLinks = () => {
	const { hasPolicyLinks, policyLinksList } = usePolicyLinks();
	const { t } = useTranslation();

	if (!hasPolicyLinks) return;

	return (
		<span>
			{policyLinksList.map(({ label, href }, idx, { length }) => (
				<>
					<a className="underline" href={href} target="_blank" rel="noreferrer">
						{label}
					</a>
					{length - idx > 2 && <>, </>}
					{length - idx === 2 && <> {t('common.and')} </>}
				</>
			))}
		</span>
	);
};

export default PolicyLinks;
