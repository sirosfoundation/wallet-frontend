import { FC, useContext, useMemo, useEffect } from 'react';
import { UserAuthPopup } from './UserAuthPopup';
import SessionContext from '@/context/SessionContext';

export type SessionRecoveryPopupProps = {
	onLogout: () => void;
	recovery: {
		resolve: () => void;
		reject: (error: Error) => void
	};
};

export const SessionRecoveryPopup: FC<SessionRecoveryPopupProps> = ({
	recovery,
	onLogout,
}) => {
	const { keystore } = useContext(SessionContext);
	const { getCachedUsers, getUserHandleB64u } = keystore;

	const recoveryUser = useMemo(() => {
		if (!recovery) return null;
		const handle = getUserHandleB64u();
		return getCachedUsers().find(u => u.userHandleB64u === handle) ?? null;
	}, [recovery, getCachedUsers, getUserHandleB64u]);

	const handleLogout = () => {
		recovery.reject(new Error('session recovery cancelled'));
		onLogout();
	};

	useEffect(() => {
		if (!recoveryUser) {
			recovery.reject(new Error('no cached user to recover'));
			onLogout();
		}
	}, [recoveryUser, recovery, onLogout]);

	if (!recoveryUser) return null;

	return (
		<UserAuthPopup
				user={recoveryUser}
				message={{ description: 'sessionRecoveryPopup.sessionExpired' }}
				onSuccess={() => {
					recovery.resolve();
				}}
				onLogout={handleLogout}
				onDismiss={handleLogout}
		/>
	);
};
