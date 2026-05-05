import React, { useEffect, useState, useContext, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StatusContext from "../context/StatusContext";
import { logger } from "@/logger";
import SessionContext from "../context/SessionContext";
import { useTranslation } from "react-i18next";
import { CachedUser } from "@/services/LocalStorageKeystore";
import SyncPopup from "@/components/Popups/SyncPopup";
import { useSessionStorage } from "@/hooks/useStorage";
import { parseOIDFlowCallbackUrl } from "@/lib/openid-flow/utils/oidFlowCallbackUrl";
import { useTenant } from "@/context/TenantContext";

export const UriHandlerProvider = ({ children }: React.PropsWithChildren) => {
	const { isOnline } = useContext(StatusContext);

	const { isLoggedIn, api, keystore, logout } = useContext(SessionContext);
	const { syncPrivateData } = api;
	const { getUserHandleB64u, getCachedUsers, getCalculatedWalletState } = keystore;

	const location = useLocation();
	// TODO: investigate and possibly remove.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [url, setUrl] = useState(window.location.href);

	// TODO: move this to a new HOC, responsible for session initialization and syncing.
	const [showSyncPopup, setSyncPopup] = useState<boolean>(false);
	const [textSyncPopup, setTextSyncPopup] = useState<{ description: string }>({ description: "" });

	const { t } = useTranslation();
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	// TODO: move this to a new HOC, responsible for session initialization and syncing.
	const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
	const [synced, setSynced] = useState(false);
	const [latestIsOnlineStatus, setLatestIsOnlineStatus,] = api.useClearOnClearSession(useSessionStorage('latestIsOnlineStatus', null));

	// TODO: move this to a new HOC, responsible for session initialization and syncing,
	// that would wrap around the UriHandlerProvider.
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

	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (window.location.search !== '' && params.get('sync') !== 'fail') {
			setSynced(false);
		}
	}, [location]);

	// TODO: move to new HOC responsible for session initialization and syncing
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

	// TODO: move to new HOC responsible for session initialization and syncing
	useEffect(() => {
		if (!getCalculatedWalletState || !cachedUser || !syncPrivateData) {
			return;
		}
		const params = new URLSearchParams(location.search);
		if (synced === false && getCalculatedWalletState() && params.get('sync') !== 'fail') {
			logger.debug("Actually syncing...");
			(async () => {
				const r = await syncPrivateData(cachedUser, keystore);
				if (!r.ok) {
					return;
				}
				setSynced(true);
			})();
		}

	}, [cachedUser, synced, setSynced, getCalculatedWalletState, syncPrivateData, location.search, keystore]);

	useEffect(() => {
		if (synced === true && window.location.search !== '') {
			setUrl(window.location.href);
		}
	}, [synced, setUrl, location]);

	// TODO: move to new HOC responsible for session initialization and syncing
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

	// TODO: rather than wrapping the whole app, this should be moved to a page
	// component, e.g. /cb, that would be responsible for all
	// OpenID4VCI/VP flows and would be the redirect URI for all OID4VCI/VP interactions.
	return (
		<Suspense fallback={null}>
			{children}
			{/* {showPinInputPopup &&
				<PinInputPopup isOpen={showPinInputPopup} setIsOpen={setShowPinInputPopup} />
			} */}
			{showSyncPopup &&
				<SyncPopup message={textSyncPopup}
					onClose={() => {
						setSyncPopup(false);
						logout();
					}}
				/>
			}
		</Suspense>
	);
}
