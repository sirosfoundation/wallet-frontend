import { createContext } from 'react';

export type ColorScheme = 'light' | 'dark' | 'system';
export type MobileVcHomeView = 'horizontal-slider' | 'vertical-slider' | 'list';

export type Settings = {
	colorScheme: ColorScheme;
	mobileVcHomeView: MobileVcHomeView;
};

export interface AppSettingsState {
	settings: Settings;
	resolvedColorScheme: 'light' | 'dark';
	setColorScheme: (t: ColorScheme) => void;
	setMobileVcHomeView: (v: MobileVcHomeView) => void;
}

const AppSettingsContext = createContext<AppSettingsState>({
	settings: { colorScheme: 'system', mobileVcHomeView: 'horizontal-slider' },
	resolvedColorScheme: 'light',
	// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
	setColorScheme: () => {},
	// biome-ignore lint/suspicious/noEmptyBlockStatements: baseline: pre-existing debt. should be fixed
	setMobileVcHomeView: () => {},
});

export default AppSettingsContext;
