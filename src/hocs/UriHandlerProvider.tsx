import React, { useEffect, useMemo, useRef, useState, useContext, Suspense } from "react";
import { useLocation, useNavigate } from "react-router";
import StatusContext from "../context/StatusContext";
import { logger } from "@/logger";
import SessionContext from "../context/SessionContext";
import { useTranslation } from "react-i18next";
import { CachedUser } from "@/services/LocalStorageKeystore";
import SyncPopup from "@/components/Popups/SyncPopup";
import { useSessionStorage } from "@/hooks/useStorage";
import { parseOIDFlowCallbackUrl } from "@/lib/openid-flow/utils/oidFlowCallbackUrl";
import { useTenant } from "@/context/TenantContext";
import PrivateDataSyncContext, { PrivateDataSyncContextValue } from "@/context/PrivateDataSyncContext";

export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	const [url, setUrl] = useState(window.location.href);

	const [showSyncPopup, setSyncPopup] = useState<boolean>(false);
	const [textSyncPopup, setTextSyncPopup] = useState<{ description: string }>({ description: "" });

	const { t } = useTranslation();
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
	const [synced, setSynced] = useState(false);
	// Set when the last sync failed without requiring re-authentication
	// (network error, repeated version conflicts).
	const [syncError, setSyncError] = useState(false);
	// `keystore` and `getCalculatedWalletState` change on every save, which
	// re-runs the sync effect while `synced === false`. This ref prevents a
	// second sync from starting while one is already running.
	const syncInFlightRef = useRef(false);

	// Reset the sync status during render (not in an effect) when navigating to
	// a URL with a query string. Child effects run before parent effects, so
	// resetting in an effect would let a newly mounted flow (e.g. /cb) observe a
	// stale `synced === true` and start writing before the sync ran.
	const [lastLocationKey, setLastLocationKey] = useState(location.key);
	if (lastLocationKey !== location.key) {
		setLastLocationKey(location.key);
		const params = new URLSearchParams(location.search);
		if (location.search !== '' && params.get('sync') !== 'fail') {
			setSynced(false);
			setSyncError(false);
		}
	}
	const [latestIsOnlineStatus, setLatestIsOnlineStatus,] = api.useClearOnClearSession(useSessionStorage('latestIsOnlineStatus', null));

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
		keystore
	]);

	useEffect(() => {
		if (!isLoggedIn) {
			setCachedUser(null);
			setSynced(false);
		}
	}, [isLoggedIn]);

	useEffect(() => {
		if (!getCalculatedWalletState || !cachedUser || !syncPrivateData) {
			return;
		}
		const params = new URLSearchParams(location.search);
		if (synced === false && !syncError && !syncInFlightRef.current && getCalculatedWalletState() && params.get('sync') !== 'fail') {
			logger.debug("Actually syncing...");
			syncInFlightRef.current = true;
			(async () => {
				try {
					const r = await syncPrivateData(cachedUser, keystore);
					if (!r.ok) {
						// 'syncFailed' after a merge failure navigates to ?sync=fail
						// itself. For other errors, stop retrying until the next
						// navigation and let pending flows continue.
						if (new URLSearchParams(window.location.search).get('sync') !== 'fail') {
							setSyncError(true);
						}
						return;
					}
					setSynced(true);
				} finally {
					syncInFlightRef.current = false;
				}
			})();
		}

	}, [cachedUser, synced, syncError, setSynced, getCalculatedWalletState, syncPrivateData, location.search, keystore]);

	useEffect(() => {
		// Also proceed after a non-reauth sync error: private-data writes merge
		// and retry on conflict, so flows are safe to start.
		if ((synced === true || syncError) && window.location.search !== '') {
			setUrl(window.location.href);
		}
	}, [synced, syncError, setUrl, location]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (synced === true && params.get('sync') === 'fail') {
			setSynced(false);
		}
		else if (params.get('sync') === 'fail' && synced === false) {
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

	const syncContextValue = useMemo((): PrivateDataSyncContextValue => {
		if (new URLSearchParams(location.search).get('sync') === 'fail') {
			return { status: 'reauthRequired' };
		}
		if (synced) {
			return { status: 'synced' };
		}
		return { status: syncError ? 'error' : 'pending' };
	}, [location.search, synced, syncError]);

	return (
		<PrivateDataSyncContext.Provider value={syncContextValue}>
			<Suspense fallback={null}>
				{children}
				{showSyncPopup &&
					<SyncPopup message={textSyncPopup}
						onClose={() => {
							setSyncPopup(false);
							logout();
						}}
					/>
				}
			</Suspense>
		</PrivateDataSyncContext.Provider>
	);
}
