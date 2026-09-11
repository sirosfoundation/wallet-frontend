import {
	WscdPlugin,
	WscdManagerHosts,
	WscdHostStrength,
} from './resources';

/**
 * The WSCD Manager Client is the public interface of the WSCD, and contains
 * methods for signing and managing cryptographic operations within the WSCD.
 *
 * Internally, it manages the multiple {@link IWscdManagerHost}'s, who are
 * running the wscd-manager-wasm binary (or, bridging with the system that does),
 * in case of the native wrapper implementation.
 */
export interface IWscdManagerClient extends IWscdOperations {}

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
	 * The strength of the host, used to "order" hosts by their
	 * inherent security or trust level.
	 */
	readonly strength: WscdHostStrength;
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
	 * Run a {@link IWscdOperations} on the host.
	 */
	runOperation<T extends keyof IWscdOperations>(
		id: T,
		...args: Parameters<IWscdOperations[T]>
	): Promise<OperationReturnType<T>>;
}

/**
 * The set of cryptographic operations that a WSCD can perform.
 */
export interface IWscdOperations {
	generateKeyPairs(): Promise<void>;
	generateOpenid4vciProofs(): Promise<void>;
	signJwtPresentation(): Promise<void>;
	generateDeviceResponse(): Promise<void>;
	generateDeviceResponseForDCAPI(): Promise<void>;
	generateDeviceResponseWithProximity(): Promise<void>;
}

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
