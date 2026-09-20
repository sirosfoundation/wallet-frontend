import * as WalletSchemaCommon from './WalletStateSchemaCommon';
import * as SchemaV2 from './WalletStateSchemaVersion2';
import { JWK } from 'jose';
import { compareBy } from '@/util';

export * from './WalletStateSchemaVersion2';


export class NoCommonMergeBaseError extends Error {
	constructor(
		public readonly container1: WalletSchemaCommon.WalletStateContainerGeneric,
		public readonly container2: WalletSchemaCommon.WalletStateContainerGeneric,
	) {
		super('Cannot merge wallet histories: the two histories share no common ancestor');
		this.name = 'NoCommonMergeBaseError';
	}
}


/**
	Schema version 3 changes the storage of the private keys from wrapped to unwrapped
*/
export const SCHEMA_VERSION = 3;


export type CredentialKeyPair = {
	kid: string,
	did: string,
	alg: string,
	publicKey: JWK,
	privateKey: JWK,
}

export type WalletStateContainer = {
	events: WalletSessionEvent[];
	S: WalletStateV3OrEarlier;
	lastEventHash: string;
};

export type WalletSessionEventV3 = WalletSchemaCommon.WalletSessionEvent & WalletSessionEventTypeAttributes;
export type WalletSessionEventV3OrEarlier = SchemaV2.WalletSessionEvent | WalletSessionEventV3;
export type WalletSessionEvent = WalletSessionEventV3OrEarlier;

export type WalletSessionEventTypeAttributes = (
	SchemaV2.WalletSessionEventNewCredential
	| SchemaV2.WalletSessionEventDeleteCredential
	| WalletSessionEventNewKeypair
	| SchemaV2.WalletSessionEventDeleteKeypair
	| SchemaV2.WalletSessionEventNewPresentation
	| SchemaV2.WalletSessionEventDeletePresentation
	| SchemaV2.WalletSessionEventAlterSettings
	| SchemaV2.WalletSessionEventSaveCredentialIssuanceSession
	| SchemaV2.WalletSessionEventDeleteCredentialIssuanceSession
);

export type WalletSessionEventNewKeypair = {
	type: "new_keypair",
	kid: string,
	keypair: CredentialKeyPair,
}

export type WalletStateV3 = Omit<SchemaV2.WalletState, "keypairs"> & {
	keypairs: {
		kid: string,
		keypair: CredentialKeyPair,
	}[],
}
export type WalletStateV3OrEarlier = SchemaV2.WalletState | WalletStateV3;
export type WalletState = WalletStateV3;

export type WalletStateKeypair = WalletState['keypairs'][number];

function isV3State(state: WalletStateV3OrEarlier): state is WalletStateV3 {
	return state.schemaVersion === SCHEMA_VERSION;
}

function isV3Event(event: WalletSessionEventV3OrEarlier): event is WalletSessionEventV3 {
	return event.schemaVersion >= SCHEMA_VERSION;
}

function isLegacyState(state: WalletStateV3OrEarlier): state is SchemaV2.WalletState {
	return state.schemaVersion < SCHEMA_VERSION;
}

function keypairReducer(state: WalletStateKeypair[] = [], newEvent: WalletSessionEvent): WalletStateKeypair[] {
	// Runtime logic is identical to V2. The only difference is between
	// `SchemaV2.WalletStateKeypair.keypair.wrappedPrivateKey` and
	// `SchemaV3.WalletStateKeypair.keypair.privateKey`, but the reducer logic
	// doesn't access those fields. So we can just coerce the types.
	return SchemaV2.keypairReducer(
		state as unknown as SchemaV2.WalletStateKeypair[],
		newEvent as SchemaV2.WalletSessionEvent,
	) as unknown as WalletStateKeypair[];
}

const v2strats = SchemaV2.mergeStrategies;

export function createOperations(
	SCHEMA_VERSION: number,
	mergeStrategies: Record<WalletSessionEvent["type"], SchemaV2.MergeStrategy>,
) {

	function migrateState(state: WalletStateV3OrEarlier): WalletState {
		if (isV3State(state)) {
			return state;
		} else if ((state?.schemaVersion ?? 1) < SCHEMA_VERSION) {
			// We can't migrate wrapped private keys to unwrapped here since we don't
			// have the unwrapping key, so we have to just assume that they were
			// already unwrapped when the keystore was opened.
			return {
				...state,
				schemaVersion: SCHEMA_VERSION,
			} as unknown as WalletState;
		} else {
			throw new Error(`Cannot migrate state with schemaVersion ${state?.schemaVersion} to version ${SCHEMA_VERSION}`);
		}
	}

	function initialWalletStateContainer(): WalletStateContainer {
		return {
			S: { schemaVersion: SCHEMA_VERSION, credentials: [], presentations: [], keypairs: [], credentialIssuanceSessions: [], settings: { openidRefreshTokenMaxAgeInSeconds: '0' } },
			events: [],
			lastEventHash: "",
		}
	}

	function walletStateReducer(state: WalletStateV3OrEarlier, newEvent: WalletSessionEvent): WalletStateV3OrEarlier {
		if (isV3Event(newEvent)) {
			const stateV3 = migrateState(state);
			if (newEvent.type === "new_keypair" || newEvent.type === "delete_keypair") {
				return {
					...stateV3,
					schemaVersion: newEvent.schemaVersion,
					keypairs: keypairReducer(stateV3.keypairs, newEvent),
				};
			} else {
				// newEvent is type narrowed here to be one of the SchemaV2 event types
				// (but with `schemaVersion: 3`), so we can use the V2 reducers natively
				return {
					...state,
					schemaVersion: newEvent.schemaVersion,
					credentials: SchemaV2.credentialReducer(state.credentials, newEvent),
					presentations: SchemaV2.presentationReducer(state.presentations, newEvent),
					credentialIssuanceSessions: SchemaV2.credentialIssuanceSessionReducer(state.credentialIssuanceSessions, newEvent),
					settings: SchemaV2.settingsReducer(state.settings, newEvent)
				};
			}
		} else if (isLegacyState(state)) {
			// Note: type narrowing incorrectly concludes `newEvent: SchemaV2.WalletSessionEventNewKeypair` here,
			// but at least the types are compatible.
			return SchemaV2.WalletStateOperations.walletStateReducer(state, newEvent);
		} else {
			throw new Error(`Cannot apply event with schemaVersion ${newEvent?.schemaVersion} to state with version ${state?.schemaVersion}`);
		}
	}

	const v2ops = SchemaV2.createOperations(SCHEMA_VERSION, mergeStrategies);

	// Same per-type merge as v2, but events of a type this version does not model
	// are carried through (union, de-duplicated by eventId) instead of crashing
	// the merge.
	async function mergeDivergentHistoriesWithStrategies(
			mergedByEarlierSchemaVersions: WalletSchemaCommon.WalletSessionEvent[],
			historyA: WalletSessionEvent[],
			historyB: WalletSessionEvent[],
			parentHash: string,
	): Promise<WalletSchemaCommon.WalletSessionEvent[]> {
			const eventsByType: Record<string, [WalletSessionEvent[], WalletSessionEvent[], WalletSessionEvent[]]> = {
					new_credential: [[], [], []],
					delete_credential: [[], [], []],
					new_keypair: [[], [], []],
					delete_keypair: [[], [], []],
					new_presentation: [[], [], []],
					delete_presentation: [[], [], []],
					alter_settings: [[], [], []],
					save_credential_issuance_session: [[], [], []],
					delete_credential_issuance_session: [[], [], []],
			};
			const unrecognised: WalletSessionEvent[] = [];

			const route = (event: WalletSessionEvent, side: 0 | 1 | 2) => {
					const bucket = eventsByType[event.type];
					if (bucket) {
							bucket[side].push(event);
					} else {
							unrecognised.push(event);
					}
			};
			mergedByEarlierSchemaVersions.forEach(event => route(event as WalletSessionEvent, 0));
			historyA.forEach(event => route(event, 1));
			historyB.forEach(event => route(event, 2));

			let mergedEvents: WalletSessionEvent[] = [];
			for (const type in mergeStrategies) {
					const [earlier, a, b] = eventsByType[type];
					mergedEvents = mergedEvents.concat(
							mergeStrategies[type as WalletSessionEvent["type"]](earlier as SchemaV2.WalletSessionEvent[],
							a as SchemaV2.WalletSessionEvent[],
							b as SchemaV2.WalletSessionEvent[],
						),
					);
			}

			const seen = new Set<number>();
			for (const event of unrecognised) {
					if (!seen.has(event.eventId)) {
							seen.add(event.eventId);
							mergedEvents.push(event);
					}
			}

			mergedEvents.sort(compareBy(event => event.timestampSeconds));
			return v2ops.rebuildEventHistory(mergedEvents, parentHash);
	}

	// Carry top-level S fields this version does not model (e.g. the `extensions`
	// namespace) across a merge instead of dropping them. Later sources win.
	function mergeState(
		baseState: WalletSchemaCommon.WalletState,
		...sources: WalletSchemaCommon.WalletState[]
	): WalletSchemaCommon.WalletState {
		const knownKeys = new Set(Object.keys(initialWalletStateContainer().S));
		const result: Record<string, unknown> = { ...baseState };
		for (const source of sources) {
			for (const [key, value] of Object.entries(source)) {
				if (!knownKeys.has(key)) {
					result[key] = value;
				}
			}
		}
		return result as unknown as WalletSchemaCommon.WalletState;
	}

	// No shared ancestor means the two histories cannot be reconciled
	// automatically; surface a typed, catchable error the caller can resolve.
	function mergeWithoutCommonBase(
		container1: WalletSchemaCommon.WalletStateContainerGeneric,
		container2: WalletSchemaCommon.WalletStateContainerGeneric,
	): WalletSchemaCommon.WalletStateContainerGeneric {
		throw new NoCommonMergeBaseError(container1, container2);
	}

	return {
		...v2ops,
		migrateState,
		initialWalletStateContainer,
		walletStateReducer,
		mergeDivergentHistoriesWithStrategies,
		mergeState,
		mergeWithoutCommonBase,
	};
}

export const WalletStateOperations = createOperations(SCHEMA_VERSION, v2strats);
