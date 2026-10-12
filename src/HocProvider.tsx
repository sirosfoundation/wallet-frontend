import type React from 'react';
import type { PropsWithChildren } from 'react';
import { NativeWrapperProvider } from './hocs/NativeWrapperProvider';
import { UriHandlerProvider } from './hocs/UriHandlerProvider';

export const HocProvider: React.FC<PropsWithChildren> = ({ children }) => (
	<UriHandlerProvider>
		<NativeWrapperProvider>{children}</NativeWrapperProvider>
	</UriHandlerProvider>
);
