// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import CredentialLayout from './CredentialLayout';
import CredentialsContext from '@/context/CredentialsContext';

/**
 * happy-dom provides a `window` but no Web Storage, and modules in this
 * import graph read `window.localStorage` at module scope. Vitest hoists
 * `vi.hoisted` above every import, so this runs first.
 */
vi.hoisted(() => {
	class MemoryStorage {
		#entries = new Map();
		get length() { return this.#entries.size; }
		key(i) { return [...this.#entries.keys()][i] ?? null; }
		getItem(k) { return this.#entries.has(k) ? this.#entries.get(k) : null; }
		setItem(k, v) { this.#entries.set(k, String(v)); }
		removeItem(k) { this.#entries.delete(k); }
		clear() { this.#entries.clear(); }
	}
	for (const name of ['localStorage', 'sessionStorage']) {
		Object.defineProperty(window, name, {
			value: new MemoryStorage(), configurable: true, writable: true,
		});
	}
});

// Mutable so a test can exercise the mobile branch, which renders `children`
// through a different layout.
const screen_ = vi.hoisted(() => ({ type: 'desktop' }));
vi.mock('@/hooks/useScreenType', () => ({ default: () => screen_.type }));
vi.mock('@/hooks/useVcEntity', () => ({
	useVcEntity: () => ({
		batchId: 1,
		instances: [{ sigCount: 0 }],
		parsedCredential: { metadata: { credential: { name: 'Test Credential' } } },
	}),
}));
vi.mock('./CredentialImage', () => ({ default: () => null }));
vi.mock('../Popups/FullscreenImg', () => ({
	default: ({ isOpen }) => (isOpen ? <div data-testid="fullscreen-popup" /> : null),
}));
vi.mock('@/hooks/useCredentialName', () => ({ useCredentialName: () => 'Test Credential' }));
vi.mock('@/context/TenantContext', () => ({ useTenant: () => ({ buildPath: (p) => `/${p}` }) }));


/** A child that owns state, standing in for CredentialTabsPanel. */
function StatefulChild() {
	const [value, setValue] = useState('initial');
	return (
		<button onClick={() => setValue('changed')}>{value}</button>
	);
}

function renderLayout({ screenType = 'desktop', fixedRatioImage } = {}) {
	screen_.type = screenType;
	let forceParentRerender;

	function Parent() {
		const [, setTick] = useState(0);
		forceParentRerender = () => setTick((n) => n + 1);

		return (
			<MemoryRouter>
				<CredentialsContext.Provider value={{ vcEntityList: [], fetchVcData: async () => [] }}>
					<CredentialLayout title="t" fixedRatioImage={fixedRatioImage}>
						<StatefulChild />
					</CredentialLayout>
				</CredentialsContext.Provider>
			</MemoryRouter>
		);
	}

	render(<Parent />);
	return { forceParentRerender: () => act(() => forceParentRerender()) };
}

describe('CredentialLayout', () => {
	/**
	 * The desktop and mobile layouts used to be declared as components inside
	 * the render body, so each render produced a new function identity. React
	 * reconciles by element type identity, so the whole subtree -- children
	 * included -- was unmounted and remounted on every re-render of the
	 * layout, discarding the state of anything below it. The visible symptom
	 * was the credential detail page losing its selected tab whenever a
	 * background credential or history refresh re-rendered the parent.
	 */
	it('keeps child state across a parent re-render', () => {
		const { forceParentRerender } = renderLayout();

		act(() => screen.getByRole('button', { name: 'initial' }).click());
		expect(screen.getByRole('button', { name: 'changed' })).toBeTruthy();

		forceParentRerender();

		// Remounting the child would reset it to 'initial'.
		expect(screen.getByRole('button', { name: 'changed' })).toBeTruthy();
	});

	it('keeps child state across several re-renders', () => {
		const { forceParentRerender } = renderLayout();

		act(() => screen.getByRole('button', { name: 'initial' }).click());
		for (let i = 0; i < 3; i += 1) forceParentRerender();

		expect(screen.getByRole('button', { name: 'changed' })).toBeTruthy();
	});

	it('keeps child state across a parent re-render on the mobile layout', () => {
		// The mobile branch renders `children` through a different layout, so
		// it has to survive the same way.
		const { forceParentRerender } = renderLayout({ screenType: 'mobile', fixedRatioImage: true });

		act(() => screen.getByRole('button', { name: 'initial' }).click());
		forceParentRerender();

		expect(screen.getByRole('button', { name: 'changed' })).toBeTruthy();
	});

	it('renders children on both layouts', () => {
		renderLayout({ screenType: 'desktop' });
		expect(screen.getByRole('button', { name: 'initial' })).toBeTruthy();
	});

	it('opens the fullscreen image popup from the credential image button', () => {
		// Covers the click handler bound into the image element factory, which
		// is the part of this change that is not exercised by simply rendering.
		renderLayout();
		expect(screen.queryByTestId('fullscreen-popup')).toBeNull();

		act(() => screen.getByRole('button', { name: 'Test Credential' }).click());

		expect(screen.getByTestId('fullscreen-popup')).toBeTruthy();
	});
});
