import {
	WscdPlugin,
	WscdManagerHosts,
	WscdHostStrength,
	WscdContainer,
} from './resources';
import { SessionTranscriptDcApiOptions, SessionTranscriptOptions } from '../verifiable-credentials';

/**
 * The WSCD Manager Client is the public interface of the WSCD, and contains
 * methods for signing and managing cryptographic operations within the WSCD.
 *
 * Internally, it manages the multiple {@link IWscdManagerHost}'s, who are
 * running the wscd-manager-wasm binary (or, bridging with the system that does),
 * in case of the native wrapper implementation.
 */
export interface IWscdManagerClient extends IWscdOperations {

}

/**
 * The WSCD Manager Host represents an individual host that runs the
 * wscd-manager-wasm binary (or, bridging with the system that does),
 * and is responsible for handling cryptographic operations and communication.
 */
export interface IWscdManagerHost {
	/**
	 * The unique identifier of the host.
	 */
	readonly id: WscdManagerHosts;
	/**
	 * The strength of the host, used to 'order' hosts by their
	 * inherent security or trust level.
	 */
	readonly strength: WscdHostStrength;
	/**
	 * Available plugins supported by the host.
	 */
	readonly supportedPlugins: ReadonlySet<WscdPlugin>;
	/**
	 * Initialization or setup logic for the host, if any.
	 */
	initialize(): Promise<void>;
	/**
	 * Indicates whether the host is available for use.
	 */
	isAvailable(): Promise<boolean>;
	/**
	 * Indicates whether the host is eligible for this particular operation
	 * or context.
	 */
	isEligible(requirements: WscdEligibilityRequirements): Promise<boolean>;
	/**
	 * Signs the provided data using the specified key identifier (kid).
	 */
	sign(kid: string, data: Uint8Array): Promise<Uint8Array>;
	/**
	 * Imports a container of cryptographic material into the WSCD manager client.
	 * This typically replaces the current state with the provided container.
	 */
	importContainer(container: WscdContainer): Promise<void>;
	/**
	 * Exports the current container of cryptographic material from the
	 * WSCD manager client.
	 */
	exportContainer(): Promise<WscdContainer>;
}

/**
 * Sign operations. These involve signing data or generating responses that
 * require cryptographic proofs, without new cryptographic material being created.
 */
export interface IWscdSignOperations {
	/**
	 * Sign as SD-JWT presentation.
	 */
	signSdJwtPresentation(request: SignJwtPresentationRequest): Promise<string>;
	/**
	 * Generate a device response for mDoc.
	 */
	generateDeviceResponse(request: GenerateDeviceResponseRequest): Promise<Uint8Array>;
	/**
	 * Generate a device response for mDoc for the DC API.
	 */
	generateDeviceResponseForDCAPI(request: GenerateDeviceResponseForDCAPIRequest): Promise<Uint8Array>;
	/**
	 * Generate a device response for mDoc with proximity-based authentication.
	 */
	generateDeviceResponseWithProximity(request: GenerateDeviceResponseRequest): Promise<Uint8Array>;
}

/**
 * Generate operations. These create new cryptographic material or proofs.
 *
 * They're separated from signing operations, because they (for now)
 * require exporting and saving the wscd container into the keystore/privateData
 * storage.
 */
export interface IWscdGenerateOperations {
	generateKeypairs(): Promise<void>;
	generateOpenid4vciProofs(): Promise<void>;
}

/**
 * The set of cryptographic operations that a WSCD can perform.
 *
 * @todo add {@link IWscdGenerateOperations} to the operations set.
 */
export interface IWscdOperations extends IWscdSignOperations {}

export type OperationReturnType<T extends keyof IWscdOperations> =
	ReturnType<IWscdOperations[T]>;

/**
 * The requirements an operation imposes on a host. A host is eligible only if
 * it supports the plugin, can satisfy every auth factor, and provides every
 * platform capability listed here.
 */
export type WscdEligibilityRequirements = {
	/**
	 * The plugin the key was created with
	 */
	plugin: WscdPlugin;
	/**
	 * Auth factors the key requires to be exercised (all must be satisfiable).
	 */
	factors: AuthFactor[];
};

/**
 * An unlock requirement for a key. Which factors apply is determined by the
 * key's plugin and configuration, not by the operation being performed.
 */
export type AuthFactor =
	/**
	 * No user authentication required (e.g. softkey).
	 */
	| { kind: 'none' }
	/**
	 * An OPAQUE PIN entered by the user; the host must expose a UI surface.
	 */
	| { kind: 'opaque-pin' }
	/**
	 * A WebAuthn ceremony bound to a specific relying party. The host can only
	 * satisfy it when its own origin matches this rpId.
	 */
	| { kind: 'webauthn'; rpId: string };

/**
 * Metadata associated with a WSCD key, including its plugin and required
 * authentication factors.
 */
export type WscdKeyMetadata = {
	plugin: WscdPlugin;
	factors: AuthFactor[];
};

export type SignJwtPresentationRequest = {
	nonce: string,
	audience: string,
	verifiableCredentials: any[],
	transactionDataResponseParams?: {
		transaction_data_hashes: string[],
		transaction_data_hashes_alg: string[]
	}
};

export type GenerateDeviceResponseRequest = {
	credential: string,
	disclosedClaims: string[],
	sessionTranscript: SessionTranscriptOptions,
};

export type GenerateDeviceResponseForDCAPIRequest = {
	credential: string,
	disclosedClaims: string[],
	sessionTranscript: SessionTranscriptDcApiOptions,
};

export type WorkerMessage = {
	id?: number;
} & (
	| {
		action: 'ping',
	}
	| {
		action: 'import_container',
		container: Uint8Array,
	}
	| {
		action: 'export_container',
	}
	| {
		action: 'sign_request',
		kid: string,
		data: Uint8Array,
	}
)

export type WorkerResponse = {
	id: number;
	error?: string;
} & (
	| {
		action: 'ping',
		result: true;
	}
	| {
		action: 'import_container';
		result: boolean;
	}
	| {
		action: 'export_container';
		result: Uint8Array;
	}
	| {
		action: 'sign_request';
		result: Uint8Array;
	}
)

export type WorkerResult<A extends WorkerMessage['action']> =
	Extract<WorkerResponse, { action: A }>['result'];
