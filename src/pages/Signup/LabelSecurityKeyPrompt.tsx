import React, { useContext, useEffect, useState } from 'react';

import SessionContext from '@/context/SessionContext';
import StatusContext from '@/context/StatusContext';
import { UserData } from '@/api/types';
import { toBase64Url } from '@/lib/utils';
import { logger } from '@/logger';
import LabelSecurityKeyPopup from '../../components/Popups/LabelSecurityKeyPopup';

const LabelSecurityKeyPrompt = () => {
	const { api } = useContext(SessionContext);
	const { isOnline } = useContext(StatusContext);
	const session = api.getSession();
	const showLabelSecurityKey = session?.showLabelSecurityKey;
	const loggedInCredentialId = session?.webauthnCredentialCredentialId;
	const [webauthnCredentialId, setWebauthnCredentialId] = useState<string | null>(null);

	useEffect(() => {
		if (!showLabelSecurityKey || webauthnCredentialId) return;
		if (!isOnline) {
			api.updateShowLabelSecurityKey(false);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const response = await api.get('/user/session/account-info');
				const userData = response.data as UserData;
				const securityKey = userData.webauthnCredentials?.find(cred => toBase64Url(cred.credentialId) === loggedInCredentialId);
				if (cancelled) return;
				if (securityKey)
					{setWebauthnCredentialId(securityKey.id);
				} else {
					logger.error("Could not find the newly registered security key in account-info");
					api.updateShowLabelSecurityKey(false);
				}
			} catch (error) {
				logger.error("Failed to fetch account-info for security key label", error);
				api.updateShowLabelSecurityKey(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [api, isOnline, showLabelSecurityKey, loggedInCredentialId, webauthnCredentialId]);

	const onClose = () => {
		api.updateShowLabelSecurityKey(false);
		setWebauthnCredentialId(null);
	};
	if (!showLabelSecurityKey || !webauthnCredentialId) return null;

	return (
		<LabelSecurityKeyPopup
			isOpen={true}
			webauthnCredentialId={webauthnCredentialId}
			onClose={onClose}
		/>
	);
};

export default LabelSecurityKeyPrompt;