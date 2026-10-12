import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionContext, { type SessionContextValue } from './SessionContext';
import { WscdManagerClientContext } from './WscdManagerClientContext';
import { WscdManagerClientContextProvider } from './WscdManagerClientContextProvider';

const hoisted = vi.hoisted(() => ({
	instance: null as null | {
		importer?: () => unknown;
		exporter?: (container: unknown) => Promise<void>;
		dispose: ReturnType<typeof vi.fn>;
	},
}));

vi.mock('@/lib/wscd-manager', () => ({
	WscdManagerClient: class {
		importer?: () => unknown;
		exporter?: (container: unknown) => Promise<void>;
		dispose = vi.fn().mockResolvedValue(undefined);

		constructor() {
			hoisted.instance = this;
		}

		setContainerImporter(cb: () => unknown) {
			this.importer = cb;
		}

		setContainerExporter(cb: (container: unknown) => Promise<void>) {
			this.exporter = cb;
		}
	},
}));

const order: string[] = [];
let commit: ReturnType<typeof vi.fn>;
let session: SessionContextValue;

beforeEach(() => {
	vi.clearAllMocks();
	hoisted.instance = null;
	order.length = 0;

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	commit = vi.fn(async () => {
		order.push('commit');
	});

	session = {
		api: {
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			updatePrivateData: vi.fn(async () => {
				order.push('update');
			}),
		},
		keystore: {
			exportToWscdContainer: vi.fn(async () => ({ container: true })),
			// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
			importFromWscdContainer: vi.fn(async () => {
				order.push('import');
				return [null, { private: 'data' }, commit];
			}),
		},
	} as unknown as SessionContextValue;
});

function renderProvider() {
	const seen: Array<unknown> = [];

	function Probe() {
		const ctx = React.useContext(WscdManagerClientContext);
		seen.push(ctx?.wscdManagerClient ?? null);
		return null;
	}

	const utils = render(
		<SessionContext.Provider value={session}>
			<WscdManagerClientContextProvider>
				<Probe />
			</WscdManagerClientContextProvider>
		</SessionContext.Provider>,
	);

	return { ...utils, seen };
}

// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
describe('WscdManagerClientContextProvider', () => {
	it('exposes null on first render and the client after the init effect', () => {
		const { seen } = renderProvider();

		expect(seen[0]).toBeNull();
		expect(seen[seen.length - 1]).toBe(hoisted.instance);
	});

	it('wires the importer to the keystore container export', async () => {
		renderProvider();

		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
			await hoisted.instance!.importer!();
		});

		expect(session.keystore.exportToWscdContainer).toHaveBeenCalledTimes(1);
	});

	it('runs the exporter as import -> updatePrivateData -> commit, in order', async () => {
		renderProvider();

		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
			await hoisted.instance!.exporter!({ container: true });
		});

		expect(order).toEqual(['import', 'update', 'commit']);
		expect(session.api.updatePrivateData).toHaveBeenCalledWith({ private: 'data' });
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it('disposes the client on unmount', () => {
		const { unmount } = renderProvider();
		// biome-ignore lint/style/noNonNullAssertion: baseline: pre-existing debt. should be fixed
		const { dispose } = hoisted.instance!;

		act(() => {
			unmount();
		});

		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
