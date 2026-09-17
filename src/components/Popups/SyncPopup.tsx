// MessagePopup.js
import React, { useContext } from 'react';
import { logger } from '@/logger';
import SessionContext from '@/context/SessionContext';
import { useLocation, useNavigate } from 'react-router';
import { CachedUser } from '@/services/LocalStorageKeystore';
import { UserAuthPopup } from './UserAuthPopup';

const SyncPopup = ({ message, onClose }) => {
	const navigate = useNavigate();

	const { keystore } = useContext(SessionContext);
	const location = useLocation();

	const cachedUsers = keystore.getCachedUsers();
	const from = location.search || '/';

	const getfilteredUser: () => [CachedUser | null, boolean, boolean] = () => {
		const queryParams = new URLSearchParams(from);
		const state = queryParams.get('state');
		const user = queryParams.get('user');
		const authenticated = queryParams.get('authenticated');
		if (user) {
			return [cachedUsers.find((u) => u.userHandleB64u === user), true, authenticated === 'true'];
		}
		if (state) {
			try {
				const decodedState = atob(state);
				const stateObj = JSON.parse(decodedState);
				return [cachedUsers.find(user => user.userHandleB64u === stateObj.userHandleB64u), false, authenticated === 'true'];
			} catch (error) {
				logger.error('Error decoding state:', error);
			}
		}

		return [null, false, authenticated === 'true'];
	};
	const [filteredUser] = getfilteredUser();

	const handleSuccess = () => {
		const params = new URLSearchParams(window.location.search);
		params.delete('user');
		params.delete('sync');
		navigate(`${window.location.pathname}?${params.toString()}`, { replace: true });
	}

	if (!filteredUser) {
		return;
	}

	return (
		<UserAuthPopup
			user={filteredUser}
			message={message}
			onSuccess={handleSuccess}
			onDismiss={onClose}
			onLogout={onClose}
		/>
	);
};

export default SyncPopup;
