import { compareBy, deduplicateBy } from '@/lib/utils';
import * as WalletSchemaCommon from './WalletStateSchemaCommon';
import { UnsupportedSchemaVersionError } from './WalletStateSchemaCommon';
import * as SchemaV2 from './WalletStateSchemaVersion2';
import * as SchemaV3 from './WalletStateSchemaVersion3';

export * from './WalletStateSchemaVersion3';

/**
 * Schema version 4 adds `set_extension` events and `S.extensions`, and keeps
 * members of credential and keypair entries that it does not define.
 */
export const SCHEMA_VERSION = 4;

export type Extensions = Record<string, Record<string, string>>;

export type CredentialMetadataEntry = { type: string; value: unknown };

export type WalletSessionEventSetExtension = {
	type: 'set_extension';
	namespace: string;
	key: string;
	value: string | null;
};

type SetExtensionEvent = WalletSchemaCommon.WalletSessionEvent &
	WalletSessionEventSetExtension;

export type WalletSessionEventV4 = WalletSchemaCommon.WalletSessionEvent &
	(SchemaV3.WalletSessionEventTypeAttributes | WalletSessionEventSetExtension);
export type WalletSessionEvent =
	SchemaV3.WalletSessionEvent | WalletSessionEventV4;

export type WalletStateCredential = SchemaV3.WalletStateCredential & {
	metadata?: CredentialMetadataEntry[];
};

export type WalletStateV4 = Omit<SchemaV3.WalletStateV3, 'credentials'> & {
	credentials: WalletStateCredential[];
	extensions?: Extensions;
};
export type WalletStateV4OrEarlier =
	SchemaV3.WalletStateV3OrEarlier | WalletStateV4;
export type WalletState = WalletStateV4;
export type WalletStateKeypair = WalletState['keypairs'][number];

export type WalletStateContainer = {
	events: WalletSessionEvent[];
	S: WalletStateV4OrEarlier;
	lastEventHash: string;
};

export type MergeStrategy = (
	mergedByEarlierSchemaVersions: WalletSessionEvent[],
	a: WalletSessionEvent[],
	b: WalletSessionEvent[],
) => WalletSessionEvent[];

const V1_TO_V3_EVENT_TYPES = new Set<string>(
	Object.keys(SchemaV2.mergeStrategies),
);

export function assertSupportedContainer(
	container: WalletSchemaCommon.WalletStateContainerGeneric,
): void {
	const stateVersion = container.S && 'schemaVersion' in container.S
		? container.S.schemaVersion
		: 1;

	if (
		!Number.isInteger(stateVersion) ||
		stateVersion < 1 ||
		stateVersion > SCHEMA_VERSION
	) {
		throw new UnsupportedSchemaVersionError(
			`Unsupported state schemaVersion: ${stateVersion}`,
		);
	}
	for (const event of container.events) {
		const version = event.schemaVersion;
		if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
			throw new UnsupportedSchemaVersionError(
				`Unsupported event schemaVersion: ${version}`,
			);
		}
		// set_extension stamped 3 was written before Spec 3.0 and is accepted.
		const known =
			event.type === 'set_extension'
				? version >= 3
				: V1_TO_V3_EVENT_TYPES.has(event.type);
		if (!known) {
			throw new UnsupportedSchemaVersionError(
				`Unsupported event type: ${event.type}`,
			);
		}
	}
}

/**
 * An entry is its creating event without the event fields, so members this
 * version does not define are kept.
 */
function entryOf(
	event: WalletSchemaCommon.WalletSessionEvent,
): Record<string, unknown> {
	const {
		type: _type,
		schemaVersion: _schemaVersion,
		eventId: _eventId,
		parentHash: _parentHash,
		timestampSeconds: _timestampSeconds,
		...entry
	} = event;
	return entry;
}

function credentialReducer(
	state: WalletStateCredential[] = [],
	newEvent: WalletSessionEvent,
): WalletStateCredential[] {
	switch (newEvent.type) {
		case 'new_credential':
			return state.concat([
				withoutEmptyMetadata(entryOf(newEvent) as WalletStateCredential),
			]);
		case 'delete_credential':
			return state.filter(
				(cred) => cred.credentialId !== newEvent.credentialId,
			);
		default:
			return state;
	}
}

function keypairReducer(
	state: WalletStateKeypair[] = [],
	newEvent: WalletSessionEvent,
): WalletStateKeypair[] {
	switch (newEvent.type) {
		case 'new_keypair':
			return state.concat([entryOf(newEvent) as WalletStateKeypair]);
		case 'delete_keypair':
			// Entries we cannot parse must be kept, so they may not be objects.
			return state.filter((k) => k?.kid !== newEvent.kid);
		default:
			return state;
	}
}

function extensionsReducer(
	state: Extensions = {},
	newEvent: SetExtensionEvent,
): Extensions {
	const current = Object.prototype.hasOwnProperty.call(state, newEvent.namespace)
		? state[newEvent.namespace]
		: {};
	const entries = Object.entries(current).filter(([key]) => key !== newEvent.key);
	if (newEvent.value !== null) {
		entries.push([newEvent.key, newEvent.value]);
	}
	// Object.fromEntries creates own fields even for keys like `__proto__`.
	return { ...state, [newEvent.namespace]: Object.fromEntries(entries) };
}

function migrateState(state: WalletStateV4OrEarlier): WalletState {
	const version = state?.schemaVersion ?? 1;
	if (version > SCHEMA_VERSION) {
		throw new UnsupportedSchemaVersionError(
			`Cannot migrate state with schemaVersion ${version} to version ${SCHEMA_VERSION}`,
		);
	}
	return { ...state, schemaVersion: SCHEMA_VERSION } as WalletState;
}

function walletStateReducer(
	state: WalletStateV4OrEarlier,
	newEvent: WalletSessionEvent,
): WalletStateV4OrEarlier {
	if (newEvent.schemaVersion < 3) {
		return SchemaV3.WalletStateOperations.walletStateReducer(
			state as SchemaV3.WalletStateV3OrEarlier,
			newEvent as SchemaV3.WalletSessionEvent,
		);
	}
	const s = migrateState(state);
	if (newEvent.type === 'set_extension') {
		return { ...s, extensions: extensionsReducer(s.extensions, newEvent) };
	}
	return {
		...s,
		credentials: credentialReducer(s.credentials, newEvent),
		keypairs: keypairReducer(s.keypairs, newEvent),
		presentations: SchemaV2.presentationReducer(
			s.presentations,
			newEvent as SchemaV2.WalletSessionEvent,
		),
		credentialIssuanceSessions: SchemaV2.credentialIssuanceSessionReducer(
			s.credentialIssuanceSessions,
			newEvent as SchemaV2.WalletSessionEvent,
		),
		settings: SchemaV2.settingsReducer(
			s.settings,
			newEvent as SchemaV2.WalletSessionEvent,
		),
	};
}

export const mergeStrategies: Record<
	WalletSessionEvent['type'],
	MergeStrategy
> = {
	...(SchemaV2.mergeStrategies as unknown as Record<
		SchemaV3.WalletSessionEvent['type'],
		MergeStrategy
	>),
	set_extension: (_mergedByEarlierSchemaVersions, a, b) =>
		deduplicateBy(
			a
				.concat(b)
				.filter((e): e is SetExtensionEvent => e.type === 'set_extension')
				// Newest first, so deduplicateBy keeps the newest event per key.
				.sort(
					(x, y) =>
						y.timestampSeconds - x.timestampSeconds || y.eventId - x.eventId,
				),
			(e) => JSON.stringify([e.namespace, e.key]),
		),
};

type V3MergeStrategies = Record<
	SchemaV3.WalletSessionEvent['type'],
	SchemaV2.MergeStrategy
>;

const v3ops = SchemaV3.createOperations(
	SCHEMA_VERSION,
	mergeStrategies as unknown as V3MergeStrategies,
);

async function mergeDivergentHistoriesWithStrategies(
	mergedByEarlierSchemaVersions: WalletSchemaCommon.WalletSessionEvent[],
	historyA: WalletSessionEvent[],
	historyB: WalletSessionEvent[],
	parentHash: string,
): Promise<WalletSchemaCommon.WalletSessionEvent[]> {
	const eventsByType = Object.fromEntries(
		Object.keys(mergeStrategies).map((type) => [type, [[], [], []]]),
	) as Record<
		WalletSessionEvent['type'],
		[WalletSessionEvent[], WalletSessionEvent[], WalletSessionEvent[]]
	>;

	[
		mergedByEarlierSchemaVersions as WalletSessionEvent[],
		historyA,
		historyB,
	].forEach((events, i) => {
		for (const event of events) {
			eventsByType[event.type][i].push(event);
		}
	});

	let mergedEvents: WalletSessionEvent[] = [];
	for (const type in mergeStrategies) {
		const [earlier, a, b] = eventsByType[type as WalletSessionEvent['type']];
		mergedEvents = mergedEvents.concat(
			mergeStrategies[type as WalletSessionEvent['type']](earlier, a, b),
		);
	}

	mergedEvents.sort(compareBy((e) => e.timestampSeconds));
	return v3ops.rebuildEventHistory(mergedEvents, parentHash);
}

export const WalletStateOperations = {
	...v3ops,
	initialWalletStateContainer: (): WalletStateContainer => v3ops.initialWalletStateContainer(),
	migrateState,
	walletStateReducer,
	mergeDivergentHistoriesWithStrategies,
};

/**
 * The spec says metadata is either absent or a list with at least one entry.
 * A writer must never save metadata: [] or metadata: null.
 * Readers have to accept both, and treat them as "no metadata".
 *
 * @see sirosfoundation/privatedata-spec#6.0
 */
export function withoutEmptyMetadata(
	credential: WalletStateCredential,
): WalletStateCredential {
	if (credential.metadata === undefined || credential.metadata?.length > 0) {
		return credential;
	}
	const { metadata: _metadata, ...rest } = credential;
	return rest;
}
