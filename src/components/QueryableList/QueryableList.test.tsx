import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import QueryableList from './QueryableList';

beforeEach(() => {
	i18n.changeLanguage('en');
});

afterEach(() => {
	i18n.changeLanguage('en');
});

type Item = { id: string; name: string };

const items: Item[] = [
	{ id: '1', name: 'Alpha Credential' },
	{ id: '2', name: 'Beta Credential' },
];

describe('QueryableList extraSection', () => {
	it('renders extraSection when no search query is entered', () => {
		render(
			<QueryableList<Item>
				list={items}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
				extraSection={<div data-testid="extra">Scan Physical ID entry</div>}
			/>,
		);

		expect(screen.getByTestId('extra')).toBeInTheDocument();
	});

	it('hides extraSection while a search query is active', () => {
		render(
			<QueryableList<Item>
				list={items}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
				extraSection={<div data-testid="extra">Scan Physical ID entry</div>}
			/>,
		);

		expect(screen.getByTestId('extra')).toBeInTheDocument();

		fireEvent.change(screen.getByPlaceholderText('Search credential...'), {
			target: { value: 'Alpha' },
		});

		expect(screen.queryByTestId('extra')).not.toBeInTheDocument();
	});

	it('renders nothing extra when extraSection is not provided', () => {
		render(
			<QueryableList<Item>
				list={items}
				queryField="name"
				isOnline={true}
				translationPrefix="pageAddCredentials"
				identifierField="id"
			/>,
		);

		expect(screen.queryByTestId('extra')).not.toBeInTheDocument();
	});
});
