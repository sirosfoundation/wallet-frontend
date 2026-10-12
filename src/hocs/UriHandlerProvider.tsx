import type React from 'react';
import { Suspense, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import SyncPopup from '@/components/Popups/SyncPopup';
import { useTenant } from '@/context/TenantContext';
import { useSessionStorage } from '@/hooks/useStorage';
import { parseOIDFlowCallbackUrl } from '@/lib/openid-flow/utils/oidFlowCallbackUrl';
import { logger } from '@/logger';
import type { CachedUser } from '@/services/LocalStorageKeystore';
import SessionContext from '../context/SessionContext';
import StatusContext from '../context/StatusContext';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	const [url, setUrl] = useState(window.location.href);

	const [showSyncPopup, setSyncPopup] = useState<boolean>(false);
	const [textSyncPopup, setTextSyncPopup] = useState<{ description: string }>({ description: '' });

	const { t } = useTranslation();
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
	const [synced, setSynced] = useState(false);
	const [latestIsOnlineStatus, setLatestIsOnlineStatus] = api.useClearOnClearSession(
		useSessionStorage('latestIsOnlineStatus', null),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		if (!keystore || cachedUser !== null || !isLoggedIn) {
			return;
		}

		const userHandle = getUserHandleB64u();
		if (!userHandle) {
			return;
		}
		const u = getCachedUsers().filter((user) => user.userHandleB64u === userHandle)[0];
		if (u) {
			setCachedUser(u);
		}
	}, [keystore, getCachedUsers, getUserHandleB64u, setCachedUser, cachedUser, isLoggedIn]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (window.location.search !== '' && params.get('sync') !== 'fail') {
			setSynced(false);
		}
	}, [location]);

	useEffect(() => {
		if (latestIsOnlineStatus === false && isOnline === true && cachedUser) {
			api.syncPrivateData(cachedUser, keystore);
		}
		if (isLoggedIn) {
			setLatestIsOnlineStatus(isOnline);
		} else {
			setLatestIsOnlineStatus(null);
		}
	}, [
		api,
		isLoggedIn,
		isOnline,
		latestIsOnlineStatus,
		setLatestIsOnlineStatus,
		cachedUser,
		keystore,
	]);

	useEffect(() => {
		if (!isLoggedIn) {
			setCachedUser(null);
			setSynced(false);
		}
	}, [isLoggedIn]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		if (!(getCalculatedWalletState && cachedUser && syncPrivateData)) {
			return;
		}
		const params = new URLSearchParams(location.search);
		if (synced === false && getCalculatedWalletState() && params.get('sync') !== 'fail') {
			logger.debug('Actually syncing...');
			(async () => {
				const r = await syncPrivateData(cachedUser, keystore);
				if (!r.ok) {
					return;
				}
				setSynced(true);
			})();
		}
	}, [
		cachedUser,
		synced,
		setSynced,
		getCalculatedWalletState,
		syncPrivateData,
		location.search,
		keystore,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		if (synced === true && window.location.search !== '') {
			setUrl(window.location.href);
		}
	}, [synced, setUrl, location]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (synced === true && params.get('sync') === 'fail') {
			setSynced(false);
		} else if (params.get('sync') === 'fail' && synced === false) {
			setTextSyncPopup({ description: 'syncPopup.description' });
			setSyncPopup(true);
		} else {
			setSyncPopup(false);
		}
	}, [location, t, synced]);

	// Listen for URL changes to handle incoming OpenID flow callbacks
	useEffect(() => {
		const u = new URL(url);

		if (u.pathname.endsWith('/cb')) {
			return;
		}

		const result = parseOIDFlowCallbackUrl(u);
		if (['oid4vci', 'oid4vp'].includes(result.protocol)) {
			const target = buildPath(`cb?${result.url.searchParams.toString()}`);
			setUrl(new URL(target, window.location.origin).href);
			navigate(target);
		}
	}, [url, navigate, buildPath]);

	return (
		<Suspense fallback={null}>
			{children}
			{showSyncPopup && (
				<SyncPopup
					message={textSyncPopup}
					onClose={() => {
						setSyncPopup(false);
						logout();
					}}
				/>
			)}
		</Suspense>
	);
};
