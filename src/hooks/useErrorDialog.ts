import { useContext } from 'react';
import ErrorDialogContext, { ErrorDialogContextParams } from '@/context/ErrorDialogContext';

export default function useErrorDialog(): ErrorDialogContextParams {
	const errorDialog = useContext(ErrorDialogContext);

	if (!errorDialog) {
		throw new Error(
			'useErrorDialog must be used within a <ErrorDialogContextProvider>'
		);
	}

	return errorDialog;
}
