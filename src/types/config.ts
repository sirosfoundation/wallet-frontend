import type { WalletFrontendEnvironmentConfiguration } from './env-config';

type LowerKeys<T> = { [K in keyof T as Lowercase<string & K>]: T[K] };

export type EnvConfig = Partial<LowerKeys<WalletFrontendEnvironmentConfiguration>> & {
	branding?: {
		logo_light?: string;
		logo_dark?: string;
	};
};
