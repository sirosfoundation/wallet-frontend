import React from 'react';
import {ErrorBoundary} from 'react-error-boundary';
import GlobalErrorScreen from '@/components/GlobalErrorScreen/GlobalErrorScreen';
import { logger } from '@/logger';


const GlobalErrorBoundary = ({ children }: React.PropsWithChildren) => {
	return (
		<ErrorBoundary
			fallbackRender={({error}) => (
				<GlobalErrorScreen error={error instanceof Error ? error : new Error(String(error))} />
			)}
			onError={(error, info) => {
				logger.error('Unhandled error caught by GlobalErrorBoundary', error, info.componentStack);
			}}
		>
			{children}
		</ErrorBoundary>
	);
};

export default GlobalErrorBoundary;
