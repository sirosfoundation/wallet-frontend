import React, { useCallback, useState } from 'react';
import ErrorDialogContext, { ErrorDialogState } from './ErrorDialogContext';

const MessagePopup = React.lazy(() => import('@/components/Popups/MessagePopup'));

type ErrorDialogContextProviderProps = {
	children: React.ReactNode;
};

export const ErrorDialogContextProvider = ({ children }: ErrorDialogContextProviderProps) => {
	const [error, setError] = useState<ErrorDialogState | null>(null);

	const displayError = useCallback((newError: ErrorDialogState) => {
		setError(newError);
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const onClose = () => {
		const errorOnClose = error?.onClose;
		clearError();
		if (typeof errorOnClose === "function") {
			errorOnClose();
		}
	};

	return (
		<ErrorDialogContext.Provider value={{ error, displayError, clearError }}>
			{children}
			{error && (
				<React.Suspense fallback={null}>
					<MessagePopup
						type="error"
						onClose={onClose}
						message={{
							title: error.title,
							emphasis: error.emphasis,
							description: error.description,
						}}
					/>
				</React.Suspense>
			)}
		</ErrorDialogContext.Provider>
	);
};
