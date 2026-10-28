const STORAGE_KEY = 'scanPhysicalIdLastUsed';

/**
 * Remembers that the Scan Physical ID flow was used, so the Add Credentials
 * page can list it under "Recent" (wallet-frontend#307).
 *
 * Every other Recent entry is derived from a stored credential, but the scan
 * flow is a local route rather than an issuer's credential configuration, so
 * there is nothing to derive it from -- hence this one small piece of state.
 *
 * It is a per-device convenience, not wallet data: it holds no personal
 * information, nothing depends on it being present, and losing it only means
 * the entry point is absent from Recent until the next scan. localStorage can
 * be unavailable or throw outright (private windows, blocked site data), so
 * both calls swallow failure rather than letting the page fail with it.
 */
export function recordScanPhysicalIdUsed(now: number = Date.now()): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(now));
	} catch {
		// A device that will not remember this still has the pinned entry point.
	}
}

/** Whether the Scan Physical ID flow has been used on this device. */
export function hasUsedScanPhysicalId(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}
