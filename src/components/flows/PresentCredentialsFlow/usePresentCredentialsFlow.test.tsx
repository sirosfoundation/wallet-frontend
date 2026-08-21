import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import CredentialsContext, { type CredentialsContextValue, type ExtendedVcEntity } from '@/context/CredentialsContext';
import { usePresentCredentialsFlow } from './usePresentCredentialsFlow';
import { resolveCredentialPresentationRequest } from './utils';

vi.mock('./utils', () => ({
	resolveCredentialPresentationRequest: vi.fn(async () => ({ verifier: {}, queries: [] })),
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const resolveMock = vi.mocked(resolveCredentialPresentationRequest);

/** Minimal stand-in — the hook only ever forwards these through. */
const credential = (batchId: number) => ({ batchId }) as unknown as ExtendedVcEntity;

function renderFlow(overrides: Partial<CredentialsContextValue>) {
	const value = {
		vcEntityList: null,
		latestCredentials: new Set<number>(),
		fetchVcData: async () => null,
		getData: async () => { },
		currentSlide: 1,
		setCurrentSlide: () => { },
		parseCredential: async () => null,
		credentialEngine: null,
		pendingTransactions: {},
		...overrides,
	} as CredentialsContextValue;

	return renderHook(() => usePresentCredentialsFlow(), {
		wrapper: ({ children }) => (
			<CredentialsContext.Provider value={value}>{children}</CredentialsContext.Provider>
		),
	});
}

/**
 * displayRequestOverviewScreen's promise intentionally stays pending until the
 * user accepts or declines, so it is started but never awaited here — the
 * assertions are about what it hands the resolver before that point.
 */
async function startOverview(result: ReturnType<typeof renderFlow>) {
	await act(async () => {
		void result.result.current.displayRequestOverviewScreen(
			{} as never,
			{ credentials: [] } as never,
			new Map() as never,
		);
	});
}

/** The credential list argument passed to resolveCredentialPresentationRequest. */
const credentialsArg = () => resolveMock.mock.calls[0][3];

describe('usePresentCredentialsFlow / displayRequestOverviewScreen', () => {
	beforeEach(() => {
		resolveMock.mockClear();
	});

	it('uses the already-loaded credential list without refetching', async () => {
		const loaded = [credential(1)];
		const fetchVcData = vi.fn(async () => [credential(99)]);

		await startOverview(renderFlow({ vcEntityList: loaded, fetchVcData }));

		expect(fetchVcData).not.toHaveBeenCalled();
		expect(credentialsArg()).toBe(loaded);
	});

	it('fetches on demand when the list has not loaded yet', async () => {
		// The crash this guards against: a verifier-initiated presentation can
		// resolve before the credential engine's first load populates the
		// context, leaving vcEntityList null.
		const fetched = [credential(7)];
		const fetchVcData = vi.fn(async () => fetched);

		await startOverview(renderFlow({ vcEntityList: null, fetchVcData }));

		expect(fetchVcData).toHaveBeenCalledTimes(1);
		expect(credentialsArg()).toBe(fetched);
	});

	it('falls back to an empty list when the fetch yields nothing', async () => {
		const fetchVcData = vi.fn(async () => null);

		await startOverview(renderFlow({ vcEntityList: null, fetchVcData }));

		expect(fetchVcData).toHaveBeenCalledTimes(1);
		// Never null: resolveCredentialPresentationRequest calls .filter on this.
		expect(credentialsArg()).toEqual([]);
	});
});
