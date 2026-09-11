export enum WscdManagerHosts {
	IN_PAGE = 'in-page',
	WORKER = 'worker',
	NATIVE_WRAPPER = 'native-wrapper',
	WALLET_COMPANION = 'wallet-companion',
}

export enum WscdPlugin {
	SOFTKEY = 'softkey',
	FIDO2 = 'fido2',
	R2PS = 'r2ps',
}

/**
 * A runtime/browser surface an operation may need. Capabilities are checked
 * with a plain subset test, so any implied capability must be listed
 * explicitly (e.g. a DC-API op also needs MAIN_THREAD).
 */
export enum PlatformCapability {
	/**
	 * Needs a DOM document and transient user activation; unavailable in workers.
	 */
	MAIN_THREAD = 'main-thread',
	/**
	 * Needs the Digital Credentials API (navigator.credentials `digital` request).
	 */
	DIGITAL_CREDENTIALS = 'digital-credentials',
	/**
	 * Needs a local proximity transport (BLE/NFC) for ISO 18013-5 presentation.
	 */
	PROXIMITY = 'proximity',
	/**
	 * Needs outbound fetch, e.g. R2PS remote signing against a networked HSM.
	 */
	NETWORK = 'network',
}

export enum WscdHostStrength {
	/**
	 * no isolation; same-origin, key material in page memory
	 */
	IN_PAGE = 0,
	/**
	 * off-main-thread; blocks direct key exfil, still a same-origin oracle
	 */
	WORKER = 10,
	/**
	 * separate origin/principal; real software boundary
	 */
	WALLET_COMPANION = 20,
	/**
	 * hardware-backed secure element
	 */
	NATIVE_WRAPPER = 30,
}
