import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QueryableList from './QueryableList';

// QueryableList.test.tsx imports `@/i18n`, which reads localStorage at module
// scope and so fails to load in this environment -- it is one of the suite's
// pre-existing broken files. This test lives on its own, with the same
// react-i18next stand-in the repo already uses elsewhere, so that it actually
// runs.
vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

type Item = { id: string; name: string };

const items: Item[] = [
	{ id: '1', name: 'Alpha Credential' },
	{ id: '2', name: 'Beta Credential' },
];

/** `a` precedes `b` in document order. */
const precedes = (a: Node, b: Node) =>
	Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('QueryableList extraSection placement', () => {
	// wallet-frontend#307: the extra section is the page's own entry point --
	// Scan Physical ID on Add Credentials -- not one of the queryable items, so
	// it belongs at the top of the page rather than between Recent and All,
	// which is where it used to render.
	it('renders extraSection before the search input, Recent and All', () => {
		const { container } = render(
			<QueryableList<Item>
				list={items}
				recent={['1']}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
				extraSection={<div data-testid="extra">Scan Physical ID entry</div>}
			/>
		);

		const extra = screen.getByTestId('extra');
		const search = container.querySelector('input');
		expect(search).not.toBeNull();

		const recentHeading = screen.getByText('queryableList.recent');
		const allHeading = screen.getByText('queryableList.all');

		expect(precedes(extra, search as Node), 'extraSection should precede the search input').toBe(true);
		expect(precedes(extra, recentHeading), 'extraSection should precede the Recent heading').toBe(true);
		expect(precedes(extra, allHeading), 'extraSection should precede the All heading').toBe(true);
	});

	it('still hides extraSection while a search query is active', () => {
		const { container } = render(
			<QueryableList<Item>
				list={items}
				recent={['1']}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
				extraSection={<div data-testid="extra">Scan Physical ID entry</div>}
			/>
		);

		const search = container.querySelector('input') as HTMLInputElement;
		fireEvent.change(search, { target: { value: 'Alpha' } });

		// Moving the section must not change when it is shown; a search is about
		// the issuer list, and the entry point would only be noise in the results.
		expect(screen.queryByTestId('extra')).toBeNull();
	});
});

describe('QueryableList recentExtra', () => {
	// wallet-frontend#307 again: Scan Physical ID has no credential of its own to
	// derive a Recent entry from, so the page supplies the entry directly.
	const renderWith = (props: Partial<React.ComponentProps<typeof QueryableList>> = {}) =>
		render(
			<QueryableList<Item>
				list={items}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
				{...(props as object)}
			/>
		);

	it('renders recentExtra as the first entry of the Recent grid', () => {
		renderWith({
			recent: ['1'],
			recentExtra: <button data-testid="recent-scan">Scan Physical ID</button>,
		});

		const scan = screen.getByTestId('recent-scan');
		// By id, not text: the matched item also appears in the All list below.
		const matched = document.getElementById('querylist-recent-1');
		expect(matched).not.toBeNull();
		expect(precedes(scan, matched as Node), 'recentExtra should come first in Recent').toBe(true);
	});

	// Without this the heading was gated purely on matched configurations, so a
	// freshly installed wallet with no credentials yet would have shown the entry
	// floating under no heading at all.
	it('shows the Recent and All headings when only recentExtra is present', () => {
		renderWith({ recent: [], recentExtra: <button data-testid="recent-scan">Scan</button> });

		expect(screen.getByTestId('recent-scan')).toBeTruthy();
		expect(screen.getByText('queryableList.recent')).toBeTruthy();
		expect(screen.getByText('queryableList.all')).toBeTruthy();
	});

	it('shows no Recent section when there is neither a match nor recentExtra', () => {
		renderWith({ recent: [] });

		expect(screen.queryByText('queryableList.recent')).toBeNull();
		expect(screen.queryByText('queryableList.all')).toBeNull();
	});

	it('hides recentExtra while a search query is active', () => {
		const { container } = renderWith({
			recent: ['1'],
			recentExtra: <button data-testid="recent-scan">Scan</button>,
		});

		fireEvent.change(container.querySelector('input') as HTMLInputElement, {
			target: { value: 'Alpha' },
		});
		expect(screen.queryByTestId('recent-scan')).toBeNull();
	});
});
