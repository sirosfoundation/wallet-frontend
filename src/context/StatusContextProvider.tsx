import { importJWK, jwtDecrypt } from 'jose';
import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import axios from 'axios';
import type { Keypair } from '@/services/WalletStateSchemaVersion3';
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

async function checkInternetConnection(keypair: Keypair): Promise<{ isConnected: boolean; speed: number }> {
	try {
		const startTime = new Date().getTime();
		const { publicKey, privateKey } = keypair || {}
		const sessionState = JSON.parse(sessionStorage.getItem("sessionState") || "{}")
		const { challenge, online } = await axios.post(
			`${BACKEND_URL}/status`,
			{
				...publicKey,
				uuid: sessionState.uuid,
			},
			{
				timeout: 5000, // Timeout of 5 seconds
				headers: {
					'Content-Type': 'application/jwk+json',
				},
			}).then(({ data }) => data);

		if (challenge) {
			const { payload: { access_token } } = await jwtDecrypt(challenge, await importJWK(privateKey, "ECDH-ES"))
			sessionStorage.setItem("appToken", JSON.stringify(access_token))
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

export const StatusContextProvider = ({ children }: React.PropsWithChildren) => {
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
	const walletDataKeypair = useSelector((state: AppState) => {
		return state.sessions.walletDataKeypair
	})


	const updateOnlineStatus = useCallback(async () => {
		const navigatorOnline = getNavigatorOnlineStatus();
		const internetConnection = await checkInternetConnection(walletDataKeypair);

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
	}, [dispatch, walletDataKeypair])

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

	useEffect(() => {
		let pollingInterval: NodeJS.Timeout | null = null;
		const startPolling = () => {
			pollingInterval = setInterval(async () => {
				updateOnlineStatus();
			}, 5000);
		};

		startPolling();

		if (pollingInterval) {
			clearInterval(pollingInterval);
		}

		updateOnlineStatus();
;
	}, [updateOnlineStatus]);

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

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (event.data?.type === "NEW_CONTENT_AVAILABLE") {
				if (document.hidden) {
					window.location.reload();
				} else {
					setUpdateAvailable(true);
				}
			}
		};

		if (navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener("message", handler);
		}

		return () => {
			if (navigator.serviceWorker) {
				navigator.serviceWorker.removeEventListener("message", handler);
			}
		};
	}, []);

	const dismissPwaPrompt = () => {
		setHidePwaPrompt(true);
	}

	return (
		<StatusContext.Provider value={{ isOnline, updateAvailable, connectivity, updateOnlineStatus, pwaInstallable, dismissPwaPrompt, hidePwaPrompt }}>
			{children}
		</StatusContext.Provider>
	);
};
