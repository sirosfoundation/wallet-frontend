import { importJWK, jwtDecrypt } from 'jose';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import axios from 'axios';
import { BACKEND_URL } from '../config';
import { logger } from '@/logger';
import { AppDispatch, AppState, setOffline, setOnline, setPwaInstallable, setPwaNotInstallable } from '@/store';
import { fetchEvents } from '@/store/EventStore';
import StatusContext, { Connectivity } from './StatusContext';
import { useLocalStorage } from '@/hooks/useStorage';

// Function to calculate speed based on RTT (lower RTT means higher speed)
function calculateNetworkSpeed(rtt: number): number {
	if (rtt < 100) return 5; // Excellent speed
	if (rtt < 200) return 4; // Good speed
	if (rtt < 500) return 3; // Moderate speed
	if (rtt < 1000) return 2; // Slow speed
	return 1; // Very slow speed
}

async function checkInternetConnection(): Promise<{ isConnected: boolean; speed: number }> {
	try {
		const startTime = new Date().getTime();
		const sessionPublicKeyJwk = JSON.parse(sessionStorage.getItem("sessionPublicKeyJwk") || "{}")
		const sessionState = JSON.parse(sessionStorage.getItem("sessionState") || "{}")
		const { challenge, online } = await axios.post(
			`${BACKEND_URL}/status`,
			{
			...sessionPublicKeyJwk,
			uuid: sessionState.uuid,
			},
			{
				timeout: 5000, // Timeout of 5 seconds
				headers: {
					'Content-Type': 'application/jwk+json',
				},
			}).then(({ data }) => data);

		if (challenge) {
			const sessionPrivateKeyJwk = JSON.parse(sessionStorage.getItem("sessionPrivateKeyJwk") || "{}")
			const { payload: { appToken } } = await jwtDecrypt(challenge, await importJWK(sessionPrivateKeyJwk, "RSA-OAEP-256"))
			sessionStorage.setItem("appToken", JSON.stringify(appToken))
		}

		if (online) {
			const endTime = new Date().getTime();
			const rtt = endTime - startTime; // Calculate RTT

			const speed = calculateNetworkSpeed(rtt);
			return { isConnected: true, speed };
		}

		return { isConnected: false, speed: 0 };
	} catch (error) {
		return { isConnected: false, speed: 0 };
	}
}

function getNavigatorOnlineStatus(): boolean {
	return navigator.onLine;
}

export const StatusContextProvider = ({ children }: { children: React.ReactNode }) => {
	const dispatch = useDispatch() as AppDispatch;
	const isOnline = useSelector((state: AppState) => state.status.isOnline)
	const pwaInstallable = useSelector((state: AppState) => state.status.pwaInstallable)
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [connectivity, setConnectivity] = useState<Connectivity>({
		navigatorOnline: null,
		Internet: null,
		speed: null,
	});
	const [hidePwaPrompt, setHidePwaPrompt] = useLocalStorage<boolean>("hidePwaPrompt", false);

	const lastUpdateCallTime = React.useRef<number>(0);

	const updateOnlineStatus = async (forceCheck = true) => {

		const navigatorOnline = getNavigatorOnlineStatus();
		const now = Date.now();

		// If not a forced check and last call was within the last 5 seconds, skip the update
		if (!forceCheck && now - lastUpdateCallTime.current < 5000) {
			return;
		}

		// Update the last call time
		lastUpdateCallTime.current = now;

		const internetConnection = await checkInternetConnection();

		if (internetConnection.isConnected) {
			dispatch(fetchEvents())
		}
		setConnectivity((prev) => {
			if (
				prev.navigatorOnline === navigatorOnline &&
				prev.Internet === internetConnection.isConnected &&
				prev.speed === internetConnection.speed
			) {
				return prev; // No changes, return previous state to prevent rerender
			}
			return {
				...prev,
				navigatorOnline,
				Internet: internetConnection.isConnected,
				speed: internetConnection.speed,
			};
		});

		if (internetConnection.isConnected) {
			dispatch(setOnline());
		} else {
			dispatch(setOffline());
		}
	}

	useEffect(() => {
		// Add event listeners for online/offline status
		window.addEventListener('online', () => updateOnlineStatus());
		window.addEventListener('offline', () => updateOnlineStatus());

		// Cleanup event listeners on unmount
		return () => {
			window.removeEventListener('online', () => updateOnlineStatus());
			window.removeEventListener('offline', () => updateOnlineStatus());
		};
	}, []); // eslint-disable-line

	useEffect(() => {
		logger.debug('Online status:', isOnline);
	}, [isOnline]);

	// Polling logic when offline
	useEffect(() => {
		let pollingInterval: NodeJS.Timeout | null = null;
		const startPolling = () => {
			pollingInterval = setInterval(async () => {
				updateOnlineStatus();
			}, 7000); // Poll every 7 seconds
		};

		if (!isOnline) {
			startPolling();
		} else if (pollingInterval) {
			clearInterval(pollingInterval);
		}

		return () => {
			if (pollingInterval) {
				clearInterval(pollingInterval);
			}
		};
	}, [isOnline]); // eslint-disable-line

	// Polling logic when online
	useEffect(() => {
		let pollingInterval: NodeJS.Timeout | null = null;

		const poll = () => {
			const now = Date.now();
			if (!document.hidden && now - lastUpdateCallTime.current > 20000) {
				updateOnlineStatus(false);
			}
		};

		const startPolling = () => {
			if (!pollingInterval) {
				pollingInterval = setInterval(poll, 20000);
			}
		};

		const stopPolling = () => {
			if (pollingInterval) {
				clearInterval(pollingInterval);
				pollingInterval = null;
			}
		};

		const handleVisibilityChange = () => {
			if (document.hidden) {
				stopPolling();
			} else {
				startPolling();
				poll(); // Trigger immediately when returning to foreground
			}
		};

		if (isOnline) {
			startPolling();
			document.addEventListener('visibilitychange', handleVisibilityChange);
		}

		return () => {
			stopPolling();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [isOnline]); // eslint-disable-line

	useEffect(() => {
		// beforeinstallprompt is triggered if browser can install pwa
		// it will not trigger if pwa is already installed
		const handleBeforeInstallPrompt = (event) => {
			event.preventDefault();
			if (event) {
				dispatch(setPwaInstallable());
			} else {
				dispatch(setPwaNotInstallable());
			}
		};

		// appinstaled is triggered if pwa was installed
		// we want to remove installation prompts in that case
		const handleAppInstalled = () => {
			dispatch(setPwaNotInstallable());
		};

		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		window.addEventListener("appinstalled", handleAppInstalled);

		return () => {
			window.removeEventListener("appinstalled", handleAppInstalled);
			window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		};
	}, [dispatch]);

	navigator.serviceWorker.addEventListener('message', (event) => {
		if (event.data && event.data.type === 'NEW_CONTENT_AVAILABLE') {
			const isWindowHidden = document.hidden;

			if (isWindowHidden) {
				window.location.reload();
			} else {
				setUpdateAvailable(true);
			}
		}
	});

	const dismissPwaPrompt = () => {
		setHidePwaPrompt(true);
	}

	useEffect(() => {
		updateOnlineStatus();
	}, []); // eslint-disable-line
	return (
		<StatusContext.Provider value={{ isOnline, updateAvailable, connectivity, updateOnlineStatus, pwaInstallable, dismissPwaPrompt, hidePwaPrompt }}>
			{children}
		</StatusContext.Provider>
	);
};
