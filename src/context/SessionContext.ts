import type React from 'react';
import { createContext } from 'react';
import type { OIDFlowClientAuthStore } from '@/hooks/useOIDFlowClientAuthStore';
import type { AuthTokens } from '@/lib/auth';
import type { HpkeConfig } from '@/lib/utils/ohttpHelpers';
import type { BackendApi } from '../api';
import type { LocalStorageKeystore } from '../services/LocalStorageKeystore';

export type SessionContextValue = {
	api: BackendApi;
	isLoggedIn: boolean;
	keystore: LocalStorageKeystore;
	logout: () => Promise<void>;
	consumeSessionCleared: () => boolean;
	obliviousKeyConfig: HpkeConfig;
	oidFlowClientAuthMaterialManager: OIDFlowClientAuthStore;
	authTokens: AuthTokens;
};

const SessionContext: React.Context<SessionContextValue> = createContext({
	api: undefined,
	isLoggedIn: false,
	keystore: undefined,
	obliviousKeyConfig: null,
	// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
	logout: async () => {},
	consumeSessionCleared: () => false,
	oidFlowClientAuthMaterialManager: undefined,
	authTokens: undefined,
});

export default SessionContext;
