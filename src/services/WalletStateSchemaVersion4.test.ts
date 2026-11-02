import { describe, expect, it } from 'vitest';

import { UnsupportedSchemaVersionError } from './WalletStateSchemaCommon';
import {
	assertSupportedContainer,
	WalletStateOperations,
	withoutEmptyMetadata,
	type WalletSessionEvent,
	type WalletState,
	type WalletStateContainer,
	type WalletStateCredential,
} from './WalletStateSchemaVersion4';

const credential = {
	credentialId: 1,
	format: 'dc+sd-jwt',
	data: '<credential>',
	kid: 'kid-1',
	instanceId: 0,
	batchId: 1,
	credentialIssuerIdentifier: 'https://issuer.example.com',
	credentialConfigurationId: 'config-1',
};

describe('WalletStateSchemaVersion4', () => {
	describe('refuses data it does not support', () => {
		it.each([5, 0, -1, 4.5, '4', null])('refuses state version %s', (schemaVersion) => {
			expect(() => assertSupportedContainer(container({ schemaVersion }))).toThrow(
				UnsupportedSchemaVersionError,
			);
		});

		it.each([5, 0, -1, 3.5, '4', null])('refuses event version %s', (schemaVersion) => {
			const settings = { openidRefreshTokenMaxAgeInSeconds: '5' };
			const events = [event('alter_settings', { settings, schemaVersion })];
			expect(() => assertSupportedContainer(container({}, events))).toThrow(
				UnsupportedSchemaVersionError,
			);
		});

		it('refuses an event without a version', () => {
			const { schemaVersion: _schemaVersion, ...unversioned } = event(
				'alter_settings',
				{ settings: { openidRefreshTokenMaxAgeInSeconds: '5' } },
			);
			expect(() => assertSupportedContainer(container({}, [unversioned]))).toThrow(
				UnsupportedSchemaVersionError,
			);
		});

		it.each(['something_new', '', 'constructor', '__proto__', 'toString'])(
			'refuses event type "%s"',
			(type) => {
				expect(() => assertSupportedContainer(container({}, [event(type)]))).toThrow(
					UnsupportedSchemaVersionError,
				);
			},
		);

		it.each([1, 2])('refuses set_extension stamped %s', (schemaVersion) => {
			const events = [
				event('set_extension', { namespace: 'ns', key: 'k', value: 'v' }, schemaVersion),
			];
			expect(() => assertSupportedContainer(container({}, events))).toThrow(
				UnsupportedSchemaVersionError,
			);
		});

		it('refuses to migrate a newer state', () => {
			expect(() =>
				WalletStateOperations.migrateState(container({ schemaVersion: 5 }).S),
			).toThrow(UnsupportedSchemaVersionError);
		});

		it('reads a state without schemaVersion as version 1', () => {
			const { schemaVersion: _schemaVersion, ...S } = container().S;
			expect(() => assertSupportedContainer({ ...container(), S } as WalletStateContainer)).not.toThrow();
		});
	});

	describe('version 3 data', () => {
		it('accepts set_extension stamped 3', () => {
			const ext = event(
				'set_extension',
				{ namespace: 'org.siros.wscd', key: 'k', value: 'v' },
				3,
			);
			expect(() => assertSupportedContainer(container({}, [ext]))).not.toThrow();
			expect(fold([ext]).extensions['org.siros.wscd']['k']).toBe('v');
		});

		it('migrates a version 3 state by only changing the version', () => {
			const S = {
				schemaVersion: 3,
				credentials: [
					{
						...credential,
						metadata: [{ type: 'org.siros.secret_seed', value: { ns: '00' } }],
					},
				],
				extensions: { 'org.siros.wscd': { 'kid-a1b2': '<opaque>' } },
				'x-unknown': { a: [1, null] },
			};
			expect(WalletStateOperations.migrateState(container(S).S)).toEqual({
				...container(S).S,
				schemaVersion: 4,
			});
		});

		it('does not lower the state version when applying a version 3 event', () => {
			const settings = { openidRefreshTokenMaxAgeInSeconds: '3600' };
			const S = fold([event('alter_settings', { settings }, 3)]);
			expect(S.schemaVersion).toBe(4);
			expect(S.settings).toEqual(settings);
		});
	});

	describe('keeps what it does not understand', () => {
		it('keeps metadata and unknown members of a new_credential event', () => {
			const metadata = [
				{ type: 'example.dup', value: 'first' },
				{ type: 'example.dup', value: 'second' },
			];
			const S = fold([
				event('new_credential', {
					...credential,
					metadata,
					'x-unknown': 'kept',
				}),
			]);
			expect(S.credentials).toEqual([
				{ ...credential, metadata, 'x-unknown': 'kept' },
			]);
		});

		it('keeps unknown members of a new_keypair event', () => {
			const S = fold([
				event('new_keypair', { kid: 'kp-a', keypair, 'x-unknown': 'kept' }),
			]);
			expect(S.keypairs).toEqual([{ kid: 'kp-a', keypair, 'x-unknown': 'kept' }]);
		});

		it('leaves keypair entries it cannot parse alone on delete_keypair', () => {
			const junk = [{ id: 'kp-legacy' }, 'not-an-object', 7, null];
			const S = fold([event('delete_keypair', { kid: 'kp-a' })], {
				keypairs: [...junk, { kid: 'kp-a', keypair }],
			});
			expect(S.keypairs).toEqual(junk);
		});

		it('keeps unknown state members and extensions when events are folded', () => {
			const S = fold(
				[event('alter_settings', { settings: { openidRefreshTokenMaxAgeInSeconds: '5' } })],
				{ 'x-unknown': { a: 1 }, extensions: { ns: { k: 'v' } } },
			);
			expect(S).toMatchObject({ 'x-unknown': { a: 1 }, extensions: { ns: { k: 'v' } } });
		});

		it('removes metadata together with its credential', () => {
			const S = fold([
				event('new_credential', { ...credential, metadata: [{ type: 't', value: 1 }] }),
				event('delete_credential', { credentialId: credential.credentialId }),
			]);
			expect(S.credentials).toEqual([]);
		});

		it('keeps unknown extension namespaces', () => {
			const S = fold([
				event('set_extension', {
					namespace: 'com.example.unregistered',
					key: 'k',
					value: 'opaque',
				}),
			]);
			expect(S.extensions['com.example.unregistered']['k']).toBe('opaque');
		});

		it.each(['__proto__', 'constructor', 'toString'])('keeps an extension key named %s', (key) => {
			const S = fold([event('set_extension', { namespace: 'ns', key, value: 'v' })]);
			expect(Object.prototype.hasOwnProperty.call(S.extensions['ns'], key)).toBe(true);
			expect(S.extensions['ns'][key]).toBe('v');
		});

		it.each(['__proto__', 'constructor', 'toString'])(
			'keeps an extension namespace named %s',
			(namespace) => {
				const S = fold([event('set_extension', { namespace, key: 'k', value: 'v' })]);
				expect(Object.prototype.hasOwnProperty.call(S.extensions, namespace)).toBe(true);
				expect(S.extensions[namespace]['k']).toBe('v');
			},
		);

		it('does not fail on a tombstone for a key that was never set', () => {
			const S = fold([event('set_extension', { namespace: 'ns', key: 'k', value: null })]);
			expect(S.extensions['ns']).not.toHaveProperty('k');
		});
	});

	describe('empty metadata', () => {
		it.each([[[]], [null]])('withoutEmptyMetadata drops metadata %j', (metadata) => {
			const result = withoutEmptyMetadata({ ...credential, metadata } as WalletStateCredential);
			expect(result).not.toHaveProperty('metadata');
		});

		it('withoutEmptyMetadata leaves non-empty metadata alone', () => {
			const withMetadata = { ...credential, metadata: [{ type: 't', value: 1 }] };
			expect(withoutEmptyMetadata(withMetadata)).toBe(withMetadata);
		});

		it.each([[[]], [null]])('drops metadata %j when folding a new_credential event', (metadata) => {
			const S = fold([event('new_credential', { ...credential, metadata })]);
			expect(S.credentials[0]).not.toHaveProperty('metadata');
		});
	});

	describe('extension merges', () => {
		it('keeps different keys written on two devices', async () => {
			const S = await mergeAndFold(
				[
					event('set_extension', {
						namespace: 'org.siros.wscd',
						key: 'kid-a',
						value: 'one',
					}),
				],
				[
					event('set_extension', {
						namespace: 'org.siros.wscd',
						key: 'kid-b',
						value: 'two',
					}),
				],
			);
			expect(S.extensions['org.siros.wscd']).toEqual({
				'kid-a': 'one',
				'kid-b': 'two',
			});
		});

		it('lets the newest tombstone delete the key', async () => {
			const S = await mergeAndFold(
				[
					event('set_extension', {
						namespace: 'org.siros.bbs',
						key: 'cred-1',
						value: 'state',
						timestampSeconds: 100,
					}),
					event('set_extension', {
						namespace: 'org.siros.bbs',
						key: 'cred-1',
						value: null,
						timestampSeconds: 300,
					}),
				],
				[
					event('set_extension', {
						namespace: 'org.siros.bbs',
						key: 'cred-1',
						value: 'stale',
						timestampSeconds: 200,
					}),
				],
			);
			expect(S.extensions['org.siros.bbs']).not.toHaveProperty('cred-1');
		});

		it('breaks equal timestamps by the greater eventId', async () => {
			const S = await mergeAndFold(
				[
					event('set_extension', {
						namespace: 'org.siros.wscd',
						key: 'k',
						value: 'from-A',
						eventId: 7,
						timestampSeconds: 100,
					}),
				],
				[
					event('set_extension', {
						namespace: 'org.siros.wscd',
						key: 'k',
						value: 'from-B',
						eventId: 9,
						timestampSeconds: 100,
					}),
				],
			);
			expect(S.extensions['org.siros.wscd']['k']).toBe('from-B');
		});

		it('lets a newer write after a tombstone win', async () => {
			const S = await mergeAndFold(
				[
					event('set_extension', { namespace: 'ns', key: 'k', value: 'v1', timestampSeconds: 100 }),
					event('set_extension', { namespace: 'ns', key: 'k', value: null, timestampSeconds: 200 }),
				],
				[event('set_extension', { namespace: 'ns', key: 'k', value: 'v2', timestampSeconds: 300 })],
			);
			expect(S.extensions['ns']['k']).toBe('v2');
		});

		it('gives the same result whichever device merges', async () => {
			const a = [
				event('set_extension', { namespace: 'ns', key: 'k', value: 'A', eventId: 7, timestampSeconds: 100 }),
			];
			const b = [
				event('set_extension', { namespace: 'ns', key: 'k', value: 'B', eventId: 9, timestampSeconds: 100 }),
			];
			expect((await mergeAndFold(a, b)).extensions).toEqual((await mergeAndFold(b, a)).extensions);
		});

		it('does not mix up a namespace and key that contain the separator', async () => {
			const S = await mergeAndFold(
				[event('set_extension', { namespace: 'a\u0000b', key: 'c', value: 'one' })],
				[event('set_extension', { namespace: 'a', key: 'b\u0000c', value: 'two' })],
			);
			expect(S.extensions['a\u0000b']['c']).toBe('one');
			expect(S.extensions['a']['b\u0000c']).toBe('two');
		});
	});
});

const keypair = {
	kid: 'kp-a',
	did: 'did:example:a',
	alg: 'ES256',
	publicKey: {},
	privateKey: {},
};

function container(S: object = {}, events: object[] = []): WalletStateContainer {
	return {
		lastEventHash: '',
		events,
		S: {
			schemaVersion: 4,
			credentials: [],
			keypairs: [],
			presentations: [],
			credentialIssuanceSessions: [],
			settings: { openidRefreshTokenMaxAgeInSeconds: '0' },
			...S,
		},
	} as unknown as WalletStateContainer;
}

let nextEventId = 1;
function event(type: string, fields: object = {}, schemaVersion = 4) {
	const eventId = nextEventId++;
	return {
		type,
		schemaVersion,
		eventId,
		parentHash: '',
		timestampSeconds: 100 + eventId,
		...fields,
	};
}

function fold(events: object[], S: object = {}): WalletState {
	return WalletStateOperations.migrateState(
		(events as WalletSessionEvent[]).reduce(
			(s, e) => WalletStateOperations.walletStateReducer(s, e),
			container(S).S,
		),
	);
}

async function mergeAndFold(historyA: object[], historyB: object[]): Promise<WalletState> {
	const merged = await WalletStateOperations.mergeDivergentHistoriesWithStrategies(
		[],
		historyA as WalletSessionEvent[],
		historyB as WalletSessionEvent[],
		'',
	);
	return fold(merged);
}
