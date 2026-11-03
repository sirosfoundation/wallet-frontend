import { useContext } from 'react';
import { TokenStatusListsContext } from '@/context/TokenStatusListsContext';

export function useTokenStatusLists() {
	const value = useContext(TokenStatusListsContext);
	if (!value) throw new Error('Missing TokenStatusListsContext');
	return value;
}
