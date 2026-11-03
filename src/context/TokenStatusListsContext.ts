import { ITokenStatusLists } from '@sirosfoundation/token-status-list';
import { createContext } from 'react';

export const TokenStatusListsContext = createContext<ITokenStatusLists | null>(
	null,
);
