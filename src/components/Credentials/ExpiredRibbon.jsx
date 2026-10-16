// ExpiredRibbon.js
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Corner ribbon showing why a credential cannot currently be used.
 *
 * Covers the outcomes of the DIIP v5 validity and revocation algorithm: the validFrom /
 * validUntil window, and the issuer's Token Status List.
 */
const STATUS_STYLES = {
	expired: 'bg-lm-red dark:bg-dm-red',
	revoked: 'bg-lm-red dark:bg-dm-red',
	suspended: 'bg-lm-orange dark:bg-dm-orange',
	notYetValid: 'bg-lm-orange dark:bg-dm-orange',
};

const ExpiredRibbon = ({ vcEntity, borderColor }) => {
	const { t } = useTranslation();

	// `credentialStatus` supersedes the older `isExpired` flag, which is kept in sync for
	// call sites that have not moved over yet.
	const status = vcEntity?.credentialStatus ?? (vcEntity?.isExpired ? 'expired' : null);
	if (!status) {
		return null;
	}

	return (
		<div className={`absolute bottom-0 right-0 text-white text-xs py-1 px-3 rounded-tl-lg rounded-br-2xl border ${borderColor ?? 'border-lm-gray-100 dark:border-dm-gray-900'} ${STATUS_STYLES[status] ?? STATUS_STYLES.expired}`}>
			{t(`expiredRibbon.${status}`)}
		</div>
	);
};

export default ExpiredRibbon;
