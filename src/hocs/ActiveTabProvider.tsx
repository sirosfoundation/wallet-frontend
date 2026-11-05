import { TakeOverTabPopup } from '@/components/Popups/TakeOverTabPopup';
import Spinner from '@/components/Shared/Spinner';
import {
	ActiveTabLock,
	type HandOverSession,
} from '@/lib/active-tab';
import { logger } from '@/logger';
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
	'sessionState',
	'userHandle',
	'mainKey',
	'tabId',
	'wallet_tenant_id',
];
// Keeps a tab that handed over from grabbing the lock back after its reload.
const HANDED_OVER_KEY = 'activeTab:handedOver';

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
		sessionStorage.setItem(HANDED_OVER_KEY, 'true');
		// After the lock has sent the session and released.
		setTimeout(() => window.location.reload(), 0);

		return session;
	}, []);

	const onHandedOver = useCallback((session: HandOverSession) => {
		// The other tab was logged out; keep this tab's own session.
		if (!('sessionState' in session)) {
			return;
		}

		// Never switch users through a hand-over; a different user must log in.
		const ownUserHandle = sessionStorage.getItem('userHandle');
		if (ownUserHandle !== null && ownUserHandle !== session.userHandle) {
			sessionStorage.clear();
			return;
		}

		// Tokens may belong to an earlier login; the adopted session mints fresh ones.
		for (const key of Object.keys(sessionStorage)) {
			if (key.startsWith('authToken:')) {
				sessionStorage.removeItem(key);
			}
		}

		for (const [key, value] of Object.entries(session)) {
			sessionStorage.setItem(key, value);
		}
	}, []);

	const handleTakeOver = async () => {
		sessionStorage.removeItem(HANDED_OVER_KEY);

		try {
			await lock?.takeOver();
		} catch (err) {
			logger.error('Failed to take over tab', err);
		}
	};

	useEffect(() => {
		const lock = new ActiveTabLock({ onTakenOver, onHandedOver });
		lock.start({ passive: sessionStorage.getItem(HANDED_OVER_KEY) !== null });
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
