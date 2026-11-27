import { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';

/**
 * Display properties for credential UI in Android's credential selector
 */
export interface CredentialDisplayProperties {
	title: string;
	subtitle?: string;
	icon?: string;
}

/**
 * Claim info with value and localized labels
 */
export type SdJwtClaim = {
	path: string;
	value: unknown;
	display: Record<string, string>;
};


/**
 * SD-JWT credential entry for OpenId4VpRegistry
 */
export interface SdJwtRegistryEntry {
	format: 'sd-jwt';
	id: string;
	verifiableCredentialType: string;
	claims: SdJwtClaim[];
	display: CredentialDisplayProperties;
}

export type MdocField = {
	namespace: string;
	identifier: string;
	value: unknown;
	display: Record<string, string>;
}

/**
 * mDOC credential entry for OpenId4VpRegistry
 */
export interface MdocRegistryEntry {
	format: 'mdoc';
	id: string;
	docType: string;
	fields: MdocField[];
	display: CredentialDisplayProperties;
}

export type CredentialRegistryEntry = SdJwtRegistryEntry | MdocRegistryEntry;

// To do: figure out what central and peripheral modes mean in the context of proximity interactions
export type ProximityMode = 'central' | 'peripheral';

export interface ProximityStartOptions {
	mode?: ProximityMode;
}

// To do: figure out what this means
export interface ProximityEngagement {
	mdocUri: string;
	mode: ProximityMode;
}

export interface ProximityCredentialFamily {
	credentialId: number;
	batchId: number;
	instances: number;
}

export interface ProximityRequestMap {
	credentials: {
		request: null;
		response: unknown[];
	};
	sign: {
		request: {
			credentialId: number;
			disclosedClaims: string[] | null;
			sessionTranscript: string;
		};
		response: { deviceResponse: string };
	};
	consent: {
		request: {
			docType: string;
			requestedClaims: string[];
			families: ProximityCredentialFamily[];
			readerTrust: { trusted: boolean; reason: string | null; entityName: string | null } | null;
		};
		response: { approved: boolean; credentialId?: number };
	};
	readerTrust: {
		request: { x5chain: string[] };
		response: { trusted: boolean; reason?: string; entityName?: string };
	};
	step: {
		request: { step: string };
		response: void;
	};
	complete: {
		request: { success: boolean };
		response: void;
	};
}

export interface NativeWrapper {
	updateAllCredentials(credentials: string, callbackUrl?: string): void;
	sendDcApiResponse(response: string, error?: string): void;
	isKeystoreOpen(): Promise<boolean>;
	startScanPhysicalId?(facetecApiUrl?: string): void;


	proximityStart?(options: ProximityStartOptions): Promise<ProximityEngagement>;

	proximityStop?(): Promise<boolean>;

	onProximityRequest?<Name extends keyof ProximityRequestMap>(
		name: Name,
		handler: (
			payload: ProximityRequestMap[Name]['request'],
		) => ProximityRequestMap[Name]['response'] | Promise<ProximityRequestMap[Name]['response']>,
	): () => void;

	callWscd(method: keyof WscdManagerJs, ...args: unknown[]): Promise<unknown>;
}

/**
 * Native wrapper element ska läggas in här
 */
