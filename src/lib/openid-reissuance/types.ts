import { OpenIdRefreshEntry } from '@/services/extensions/oid4vci-refresh';
import { ReissueNotice } from './resources';

export type OpenIdReissue = (batchId: number) => Promise<boolean>;
export type OpenIdGetRefreshEntry = (batchId: number) => (OpenIdRefreshEntry | null);

export type OpenIdReissuerOptions = {
	reissue: OpenIdReissue;
	getRefreshEntry: OpenIdGetRefreshEntry;
	withLock: WithLock;
};

export type OpenIdSnapshot = {
	notices: ReadonlyMap<number, ReissueNotice>;
};

export type WithLock = (task: () => Promise<void>) => Promise<void>;

/**
 * Reasons a credential can't be reissued in the background.
 */
export type ReissueBlocker =
	| ReissueNotice.NO_REFRESH_TOKEN
	| ReissueNotice.HARDWARE_BOUND;
