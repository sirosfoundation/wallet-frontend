import React, { createContext } from 'react';
import { BackendApi } from '../api';
import type { LocalStorageKeystore } from '../services/LocalStorageKeystore';
import { HpkeConfig } from '@/lib/utils/ohttpHelpers';
import { OIDFlowClientAuthStore } from '@/hooks/useOIDFlowClientAuthStore';
import { AuthTokens } from '@/lib/auth';

export type SessionContextValue = {
	api: BackendApi,
	isLoggedIn: boolean,
	keystore: LocalStorageKeystore,
	logout: () => Promise<void>,
	consumeSessionCleared: () => boolean,
	obliviousKeyConfig: HpkeConfig,
	oidFlowClientAuthMaterialManager: OIDFlowClientAuthStore,
	authTokens: AuthTokens,
};

const missingSessionContext = (property: string) => () => {
	throw new Error(`SessionContext.Provider is missing (${property})`);
};

const requiredContextObject = <T extends object>(property: string): T =>
	new Proxy({} as T, {
		get: () => missingSessionContext(property),
	});

const SessionContext: React.Context<SessionContextValue> = createContext({
	api: requiredContextObject<BackendApi>('api'),
	isLoggedIn: false,
	keystore: requiredContextObject<LocalStorageKeystore>('keystore'),
	obliviousKeyConfig: null,
	logout: async () => { },
	consumeSessionCleared: () => false,
	oidFlowClientAuthMaterialManager: requiredContextObject<OIDFlowClientAuthStore>('oidFlowClientAuthMaterialManager'),
	authTokens: requiredContextObject<AuthTokens>('authTokens'),
});

export default SessionContext;
