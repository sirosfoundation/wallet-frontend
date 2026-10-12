import { useContext } from 'react';
import ErrorDialogContext, { type ErrorDialogContextParams } from '@/context/ErrorDialogContext';

export default function useErrorDialog(): ErrorDialogContextParams {
	const errorDialog = useContext(ErrorDialogContext);

	if (!errorDialog) {
		// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
		throw new Error('useErrorDialog must be used within a <ErrorDialogContextProvider>');
	}

	return errorDialog;
}
