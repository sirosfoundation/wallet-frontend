import { TakeOverTabPopup } from '@/components/Popups/TakeOverTabPopup';
import Spinner from '@/components/Shared/Spinner';
import { SESSION_STATE_KEY } from '@/api';
import {
	ActiveTabLock,
	type HandOverSession,
} from '@/lib/active-tab';
import { AuthTokens } from '@/lib/auth';
import { SESSION_TENANT_KEY } from '@/lib/tenant';
import { logger } from '@/logger';
import {
	SESSION_MAIN_KEY_KEY,
	SESSION_TAB_ID_KEY,
	SESSION_USER_HANDLE_KEY,
} from '@/services/LocalStorageKeystore';
import {
	FC,
	PropsWithChildren,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
} from 'react';

// The login session and keystore; tokens are left out so the new tab mints fresh ones.
const SESSION_KEYS = [
	SESSION_STATE_KEY,
	SESSION_USER_HANDLE_KEY,
	SESSION_MAIN_KEY_KEY,
	SESSION_TAB_ID_KEY,
	SESSION_TENANT_KEY,
];
// Keeps a tab that handed over from grabbing the lock back after its reload.
const SESSION_HANDED_OVER_KEY = 'activeTab:handedOver';

export const ActiveTabProvider: FC<PropsWithChildren> = ({ children }) => {
	const [lock, setLock] = useState<ActiveTabLock | null>(null);

	const onTakenOver = useCallback((): HandOverSession => {
		const session: HandOverSession = {};
		for (const key of SESSION_KEYS) {
			const value = sessionStorage.getItem(key);
			if (value !== null) {
				session[key] = value;
			}
		}

		sessionStorage.clear();
		sessionStorage.setItem(SESSION_HANDED_OVER_KEY, 'true');
		// After the lock has sent the session and released.
		setTimeout(() => window.location.reload(), 0);

		return session;
	}, []);

	const onHandedOver = useCallback((session: HandOverSession) => {
		// The other tab was logged out; keep this tab's own session.
		if (!(SESSION_STATE_KEY in session)) {
			return;
		}

		// Never switch users through a hand-over; a different user must log in.
		const ownUserHandle = sessionStorage.getItem(SESSION_USER_HANDLE_KEY);
		if (ownUserHandle !== null && ownUserHandle !== session[SESSION_USER_HANDLE_KEY]) {
			sessionStorage.clear();
			return;
		}

		// Tokens may belong to an earlier login; the adopted session mints fresh ones.
		AuthTokens.clearStorage(sessionStorage);

		for (const [key, value] of Object.entries(session)) {
			sessionStorage.setItem(key, value);
		}
	}, []);

	const handleTakeOver = async () => {
		sessionStorage.removeItem(SESSION_HANDED_OVER_KEY);

		try {
			await lock?.takeOver();
		} catch (err) {
			logger.error('Failed to take over tab', err);
		}
	};

	useEffect(() => {
		const lock = new ActiveTabLock({ onTakenOver, onHandedOver });
		lock.start({ passive: sessionStorage.getItem(SESSION_HANDED_OVER_KEY) !== null });
		setLock(lock);
		return () => lock.dispose();
	}, [onTakenOver, onHandedOver]);

	const lockState = useSyncExternalStore(
		useCallback((onChange) => lock?.subscribe(onChange) ?? (() => {}), [lock]),
		() => lock?.getSnapshot(),
	);

	useEffect(() => {
		if (!lockState?.state) return;

		const original = document.title;

		if (lockState.state === 'inactive') {
			document.title = `[Inactive] ${original}`;
		}

		return () => {
			document.title = original;
		};
	}, [lockState?.state]);

	if (!lockState?.state) return <Spinner />;

	switch (lockState.state) {
		case 'pending':
			return <Spinner />;
		case 'inactive':
			return <TakeOverTabPopup onTakeOver={handleTakeOver} />;
		case 'active':
			return children;
	}
};
