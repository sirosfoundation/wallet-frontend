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
