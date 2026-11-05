/**
 * Why a credential needs the user to reissue it.
 */
export enum ReissueNotice {
	NO_REFRESH_TOKEN = 'no-refresh-token',
	HARDWARE_BOUND = 'hardware-bound',
	REISSUE_FAILED = 'reissue-failed',
}
