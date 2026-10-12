import axios from 'axios';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '@/hooks/useStorage';
import { BACKEND_URL } from '../config';
import { getTenantFromUrlPath } from '../lib/tenant';
import { logger } from '../logger';
import StatusContext, { type Connectivity } from './StatusContext';

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
		// biome-ignore lint/complexity/useDateNow: baseline: pre-existing debt. should be fixed
		const startTime = new Date().getTime();
		const tenantId = getTenantFromUrlPath() || 'default';
		await axios.get(`${BACKEND_URL}/status`, {
			timeout: 5000, // Timeout of 5 seconds
			headers: {
				'Content-Type': 'application/json',
				'X-Tenant-ID': tenantId,
			},
		});
		// biome-ignore lint/complexity/useDateNow: baseline: pre-existing debt. should be fixed
		const endTime = new Date().getTime();
		const rtt = endTime - startTime; // Calculate RTT

		const speed = calculateNetworkSpeed(rtt);
		return { isConnected: true, speed };
		// biome-ignore lint/complexity/noUselessCatchBinding: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
	} catch (error) {
		return { isConnected: false, speed: 0 };
	}
}

function getNavigatorOnlineStatus(): boolean {
	return navigator.onLine;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export const StatusContextProvider = ({ children }: React.PropsWithChildren) => {
	const [isOnline, setIsOnline] = useState<boolean | null>(null);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [connectivity, setConnectivity] = useState<Connectivity>({
		navigatorOnline: null,
		Internet: null,
		speed: null,
	});
	const [pwaInstallable, setPwaInstallable] = useState(null);
	const [hidePwaPrompt, setHidePwaPrompt] = useLocalStorage<boolean>('hidePwaPrompt', false);

	const updateBlockers = useRef<Map<string, { label: string; since: number }>>(new Map());
	const [isSafeToUpdate, setIsSafeToUpdate] = useState(true);
	const [isStaleVersion, setIsStaleVersion] = useState(false);
	const [isSwWaiting, setIsSwWaiting] = useState(false);

	const lastUpdateCallTime = React.useRef<number>(0);

	const blockUpdates = useCallback((label: string) => {
		const key = crypto.randomUUID();
		updateBlockers.current.set(key, { label, since: Date.now() });
		setIsSafeToUpdate(false);

		let released = false;

		return () => {
			if (released) return;
			released = true;
			updateBlockers.current.delete(key);
			setIsSafeToUpdate(updateBlockers.current.size === 0);
		};
	}, []);

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

		setIsOnline((prev) => {
			if (prev === internetConnection.isConnected) {
				return prev; // No change in `isOnline`
			}
			return internetConnection.isConnected;
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		// Add event listeners for online/offline status
		window.addEventListener('online', () => updateOnlineStatus());
		window.addEventListener('offline', () => updateOnlineStatus());

		// Cleanup event listeners on unmount
		return () => {
			window.removeEventListener('online', () => updateOnlineStatus());
			window.removeEventListener('offline', () => updateOnlineStatus());
		};
	}, []);

	useEffect(() => {
		logger.debug('Online status:', isOnline);
	}, [isOnline]);

	// Polling logic when offline
	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		let pollingInterval: NodeJS.Timeout | null = null;
		const startPolling = () => {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
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
	}, [isOnline]);

	// Polling logic when online
	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
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
	}, [isOnline]);

	useEffect(() => {
		// beforeinstallprompt is triggered if browser can install pwa
		// it will not trigger if pwa is already installed
		const handleBeforeInstallPrompt = (event) => {
			event.preventDefault();
			setPwaInstallable(event);
		};

		// appinstaled is triggered if pwa was installed
		// we want to remove installation prompts in that case
		const handleAppInstalled = () => {
			setPwaInstallable(null);
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);

		return () => {
			window.removeEventListener('appinstalled', handleAppInstalled);
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		};
	}, []);

	useEffect(() => {
		const buildId = import.meta.env.VITE_BUILD_ID;
		if (!buildId) return;

		const channel = new BroadcastChannel('sirosid:app-version');
		channel.postMessage(buildId);

		channel.addEventListener('message', (e) => {
			if (e.data !== buildId) setIsStaleVersion(true);
		});

		return () => channel.close();
	}, []);

	useEffect(() => {
		if (isStaleVersion && isSafeToUpdate) {
			window.location.reload();
		}
	}, [isStaleVersion, isSafeToUpdate]);

	useEffect(() => {
		if (!navigator.serviceWorker) return;

		// biome-ignore lint/complexity/noVoid: baseline: pre-existing debt. should be fixed
		void (async () => {
			const reg = await navigator.serviceWorker.getRegistration();
			if (!reg) return;

			if (reg.waiting) setIsSwWaiting(true);

			reg.addEventListener('updatefound', () => {
				const worker = reg.installing;
				worker?.addEventListener('statechange', () => {
					if (worker.state === 'installed') setIsSwWaiting(true);
				});
			});
		})();
	}, []);

	useEffect(() => {
		if (!(isSwWaiting && isSafeToUpdate && navigator.serviceWorker)) return;
		// biome-ignore lint/complexity/noVoid: baseline: pre-existing debt. should be fixed
		void (async () => {
			const reg = await navigator.serviceWorker.getRegistration();
			reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
		})();
	}, [isSwWaiting, isSafeToUpdate]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (event.data?.type === 'NEW_CONTENT_AVAILABLE') {
				if (document.hidden && isSafeToUpdate) {
					window.location.reload();
				} else {
					setUpdateAvailable(true);
				}
			}
		};

		if (navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener('message', handler);
		}

		return () => {
			if (navigator.serviceWorker) {
				navigator.serviceWorker.removeEventListener('message', handler);
			}
		};
	}, [isSafeToUpdate]);

	const dismissPwaPrompt = () => {
		setHidePwaPrompt(true);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	useEffect(() => {
		updateOnlineStatus();
	}, []);

	const value = {
		isOnline,
		updateAvailable,
		connectivity,
		updateOnlineStatus,
		pwaInstallable,
		dismissPwaPrompt,
		hidePwaPrompt,
		isSafeToUpdate,
		blockUpdates,
	};

	return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
};
