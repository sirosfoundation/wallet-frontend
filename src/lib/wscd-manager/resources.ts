import { z } from 'zod';

export enum WscdManagerHosts {
	IN_PAGE = 'in-page',
	WORKER = 'worker',
	NATIVE_WRAPPER = 'native-wrapper',
	WALLET_COMPANION = 'wallet-companion',
}

export enum WscdPlugin {
	SOFTKEY = 'softkey',
	FIDO2 = 'fido2',
	R2PS = 'r2ps',
}

export enum WscdHostStrength {
	/**
	 * no isolation; same-origin, key material in page memory
	 */
	IN_PAGE = 0,
	/**
	 * off-main-thread; blocks direct key exfil, still a same-origin oracle
	 */
	WORKER = 10,
	/**
	 * separate origin/principal; real software boundary
	 */
	WALLET_COMPANION = 20,
	/**
	 * hardware-backed secure element
	 */
	NATIVE_WRAPPER = 30,
}

/**
 * Cryptographic key managed by the WSCD manager.
 */
export const WscdKeySchema = z.object({
	kid: z.string(),
	algorithm: z.string(),
	d: z.string(),
	created_at: z.number(),
});
export type WscdKey = z.infer<typeof WscdKeySchema>;

/**
 * Kind of factor managed by the WSCD manager.
 */
export const WscdFactorKindSchema = z.enum(['Opaque', 'WebAuthn', 'RawSign']);
export type WscdFactorKind = z.infer<typeof WscdFactorKindSchema>;

/**
 * Lifecycle state of a factor managed by the WSCD manager.
 */
export const WscdLifecycleStateSchema = z.enum([
	'Uninitialized', 'Registered', 'Active', 'Suspended', 'Destroyed',
]);
export type WscdLifecycleState = z.infer<typeof WscdLifecycleStateSchema>;

/**
 * Context information for the lifecycle of a factor managed by the WSCD manager.
 */
export const WscdLifecycleContextSchema = z.object({
	factor_kind: WscdFactorKindSchema,
	state: WscdLifecycleStateSchema,
	updated_at: z.number(),
	key_ids: z.array(z.string()),
});
export type WscdLifecycleContext = z.infer<typeof WscdLifecycleContextSchema>;

/**
 * Container for managing cryptographic keys and their associated lifecycle
 * contexts within the WSCD manager.
 */
export const WscdContainerSchema = z.object({
	keys: z.array(WscdKeySchema),
	lifecycle: z.record(z.string(), WscdLifecycleContextSchema).default({}),
});
export type WscdContainer = z.infer<typeof WscdContainerSchema>;
