// CredentialsContext.ts
import { CurrentSchema } from '@/services/WalletStateSchema';
import { createContext } from 'react';
import { ParsedCredential, ParsingEngineI, CredentialVerifier } from 'wallet-common';

type WalletStateCredential = CurrentSchema.WalletStateCredential;

type CredentialEngine = {
	credentialParsingEngine: ParsingEngineI;
	sdJwtVerifier: CredentialVerifier;
	msoMdocVerifier: CredentialVerifier;
};

export type Instance = {
	instanceId: number;
	sigCount: number;
}

/**
 * Why a credential cannot currently be used, or `null` when it can.
 *
 * These are the outcomes of the DIIP v5 validity and revocation algorithm: the `validFrom` /
 * `validUntil` window, and the issuer's Token Status List.
 */
export type CredentialStatus = 'expired' | 'notYetValid' | 'revoked' | 'suspended' | null;

export type ExtendedVcEntity = WalletStateCredential & {
	parsedCredential: ParsedCredential;
	credentialStatus: CredentialStatus;
	/** @deprecated prefer `credentialStatus`; kept so existing call sites keep working. */
	isExpired: boolean;
	instances: Instance[];
	sigCount: number; // calculate usage by parsing all presentation history
}

export type CredentialsContextValue = {
	vcEntityList: ExtendedVcEntity[];
	latestCredentials: Set<number>;
	fetchVcData: (credentialId?: number) => Promise<ExtendedVcEntity[]>;
	getData: (shouldPoll?: boolean) => Promise<void>;
	currentSlide: number;
	setCurrentSlide: (slide: number) => void;
	parseCredential: (credential: WalletStateCredential) => Promise<ParsedCredential | null>;
	credentialEngine: CredentialEngine | null;
	pendingTransactions: Record<string, any>;
};

const defaultContextValue: CredentialsContextValue = {
	vcEntityList: [],
	latestCredentials: new Set<number>(),
	fetchVcData: async () => [],
	getData: async () => { },
	currentSlide: 1,
	setCurrentSlide: () => { },
	parseCredential: async () => null,
	credentialEngine: null,
	pendingTransactions: null,
};
const CredentialsContext = createContext<CredentialsContextValue>(defaultContextValue);

export default CredentialsContext;
