import React, { createContext } from 'react';
import { BackendApi } from '../api';
import type { LocalStorageKeystore } from '../services/LocalStorageKeystore';
import type { WalletSigner } from '../services/walletSigner';
import { HpkeConfig } from '@/lib/utils/ohttpHelpers';

export type SessionContextValue = {
	api: BackendApi,
	isLoggedIn: boolean,
	keystore: LocalStorageKeystore,
	/** Pluggable signing backend — defaults to WebCrypto when not set. */
	walletSigner?: WalletSigner,
	logout: () => Promise<void>,
	obliviousKeyConfig: HpkeConfig
};

const SessionContext: React.Context<SessionContextValue> = createContext({
	api: undefined,
	isLoggedIn: false,
	keystore: undefined,
	walletSigner: undefined,
	obliviousKeyConfig: null,
	logout: async () => { },
});

export default SessionContext;
