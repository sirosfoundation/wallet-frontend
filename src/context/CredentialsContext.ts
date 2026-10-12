// CredentialsContext.ts

import { createContext } from 'react';
import type { CredentialVerifier, ParsedCredential, ParsingEngineI } from 'wallet-common';
import type { CurrentSchema } from '@/services/WalletStateSchema';

type WalletStateCredential = CurrentSchema.WalletStateCredential;

type CredentialEngine = {
	credentialParsingEngine: ParsingEngineI;
	sdJwtVerifier: CredentialVerifier;
	msoMdocVerifier: CredentialVerifier;
};

export type Instance = {
	instanceId: number;
	sigCount: number;
};

export type ExtendedVcEntity = WalletStateCredential & {
	parsedCredential: ParsedCredential;
	isExpired: boolean;
	instances: Instance[];
	sigCount: number; // calculate usage by parsing all presentation history
};

export type CredentialsContextValue = {
	/**
	 * Loaded credentials, or null while they are still being fetched.
	 *
	 * Nullable on purpose: CredentialsContextProvider initialises this to null
	 * and only populates it once the credential engine has parsed the wallet's
	 * store. This type previously claimed ExtendedVcEntity[], which let
	 * consumers call array methods on it with no complaint from the compiler -
	 * the presentation flow did exactly that and crashed with "Cannot read
	 * properties of null (reading 'filter')" whenever a verifier-initiated
	 * request arrived before the first load finished.
	 */
	vcEntityList: ExtendedVcEntity[] | null;
	latestCredentials: Set<number>;
	fetchVcData: (credentialId?: number) => Promise<ExtendedVcEntity[] | null>;
	getData: (shouldPoll?: boolean) => Promise<void>;
	currentSlide: number;
	setCurrentSlide: (slide: number) => void;
	parseCredential: (credential: WalletStateCredential) => Promise<ParsedCredential | null>;
	credentialEngine: CredentialEngine | null;
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	pendingTransactions: Record<string, any>;
};

const defaultContextValue: CredentialsContextValue = {
	vcEntityList: [],
	latestCredentials: new Set<number>(),
	fetchVcData: async () => [],
	// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
	getData: async () => {},
	currentSlide: 1,
	// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
	setCurrentSlide: () => {},
	parseCredential: async () => null,
	credentialEngine: null,
	pendingTransactions: null,
};
const CredentialsContext = createContext<CredentialsContextValue>(defaultContextValue);

export default CredentialsContext;
