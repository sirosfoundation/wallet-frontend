import React, { createContext } from 'react';
import { BackendApi } from '../api';
import type { LocalStorageKeystore } from '../services/LocalStorageKeystore';
import { HpkeConfig } from '@/lib/utils/ohttpHelpers';
import { OIDFlowClientAuthMaterialManager } from '@/hooks/useOIDFlowClientAuthMaterialManager';

export type SessionContextValue = {
	api: BackendApi,
	isLoggedIn: boolean,
	keystore: LocalStorageKeystore,
	logout: () => Promise<void>,
	consumeSessionCleared: () => boolean,
	obliviousKeyConfig: HpkeConfig,
	oidFlowClientAuthMaterialManager: OIDFlowClientAuthMaterialManager,
};

const SessionContext: React.Context<SessionContextValue> = createContext({
	api: undefined,
	isLoggedIn: false,
	keystore: undefined,
	obliviousKeyConfig: null,
	logout: async () => { },
	consumeSessionCleared: () => false,
	oidFlowClientAuthMaterialManager: undefined,
});

export default SessionContext;
