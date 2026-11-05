import { createContext } from 'react';
import { OpenIdReissuer } from '@/lib/openid-reissuance';

export const OpenIdReissuanceContext = createContext<OpenIdReissuer | null>(
	null,
);
