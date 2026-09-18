import React, { useContext, useState, useCallback, FC } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import Button from '../Buttons/Button';
import PopupLayout from './PopupLayout';
import SessionContext from '@/context/SessionContext';
import { useTenant } from '@/context/TenantContext';
import checkForUpdates from '@/offlineUpdateSW';
import { UserLock } from 'lucide-react';
import { CachedUser } from '@/services/LocalStorageKeystore';

export type UserAuthPopupProps = {
	user: CachedUser;
	message: {
		description: string;
	};
	onLogout: () => void;
	onDismiss: () => void;
	onSuccess: () => void;
};

export const UserAuthPopup: FC<UserAuthPopupProps> = ({
	user,
	message,
	onLogout,
	onDismiss,
	onSuccess
}) => {
	const { description } = message || {};
	const { t } = useTranslation();
	const { api, keystore } = useContext(SessionContext);
	const [error, setError] = useState('');
	const { effectiveTenantId } = useTenant();

	const [isSubmitting, setIsSubmitting] = useState(false);

	const onLogin = useCallback(
		async (cachedUser: CachedUser) => {
			// Pass the tenantId from URL path to ensure proper tenant-scoped login
			const result = await api.loginWebauthn(keystore, async () => false, [], cachedUser, effectiveTenantId);
			if (result.ok) {
				onSuccess();
			} else {
				const err = result.val;

				// Using a switch here so the t() argument can be a literal, to ease searching
				switch (err) {
					case 'loginKeystoreFailed':
						setError(t('loginSignup.loginKeystoreFailed'));
						break;

					case 'passkeyInvalid':
						setError(t('loginSignup.passkeyInvalid'));
						break;

					case 'passkeyLoginFailedTryAgain':
						setError(t('loginSignup.passkeyLoginFailedTryAgain'));
						break;

					case 'passkeyLoginFailedServerError':
						setError(t('loginSignup.passkeyLoginFailedServerError'));
						break;

					default:
						throw result;
				}
			}
		},
		[api, keystore, t, effectiveTenantId, onSuccess],
	);

	const onLoginCachedUser = async (cachedUser: CachedUser) => {
		setError('');
		setIsSubmitting(true);
		try {
			await onLogin(cachedUser);
			checkForUpdates();
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<PopupLayout isOpen={true} onClose={onDismiss} shouldCloseOnOverlayClick={false}>
			<div className="flex flex-col items-center text-center mb-2">
				<p className="font-bold text-xl mt-2 dark:text-dm-gray-100">
					{t('loginState.title')} {user.displayName}
				</p>
				<p className=" mb-2 mt-2 dark:text-dm-gray-100">
					<Trans
						i18nKey={description}
						components={{ strong: <strong /> }}
					/>
				</p>
			</div>
			<ul className=" p-2">
				<div className='flex flex-col gap-4 justify-center mr-2'>
					<Button
						id={`${isSubmitting ? 'submitting' : 'continue'}-login-state`}
						onClick={() => onLoginCachedUser(user)}
						variant="primary"
						disabled={isSubmitting}
						additionalClassName='w-full'
					>
						<UserLock className="inline text-xl mr-2" />
						{isSubmitting
							? t('loginSignup.submitting')
							: t('loginSignup.loginWithPasskey')}
					</Button>
					<Button
						id="cancel-login-state"
						onClick={onLogout}
						disabled={isSubmitting}
						additionalClassName='w-full'
					>
						{t('common.declineAndExit')}
					</Button>
				</div>
			</ul>
			{error && <div className="text-lm-red dark:text-dm-red pt-2">{error}</div>}
		</PopupLayout>
	);
};
