import { createContext } from 'react';

export interface Connectivity {
	navigatorOnline: boolean | null;
	Internet: boolean | null;
	speed: number | null;
}

interface StatusContextValue {
	isOnline: boolean;
	updateAvailable: boolean;
	/**
	 * Indicates whether it is safe to perform an update.
	 */
	isSafeToUpdate: boolean;
	/**
	 * Block app updates from being performed.
	 * Meant to be used during critical operations or flows where the wallet
	 * processes ephemeral data (e.g., temporary keys or session information) or
	 * write operations to persistent storage.
	 *
	 * @returns A function that must be called to unblock updates.
	 */
	blockUpdates: (label: string) => () => void;
	connectivity: Connectivity;
	pwaInstallable: Event;
	dismissPwaPrompt: () => void;
	hidePwaPrompt: boolean;
	updateOnlineStatus: (forceCheck?: boolean) => Promise<void>;
}

const StatusContext = createContext<StatusContextValue>({
	isOnline: false,
	isSafeToUpdate: true,
	updateAvailable: false,
	connectivity: { navigatorOnline: null, Internet: null, speed: null },
	pwaInstallable: null,
	dismissPwaPrompt: () => { },
	hidePwaPrompt: false,
	updateOnlineStatus: async () => { },
	blockUpdates: () => () => { },
});

export default StatusContext;
