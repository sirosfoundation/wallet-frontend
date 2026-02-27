import { createContext } from 'react';

export type ErrorDialogState = {
	title: string;
	description: string;
	emphasis?: string;
	err?: Error;
	onClose?: () => void;
}

export type DisplayErrorFunction = (error: ErrorDialogState) => void;
export type ClearErrorFunction = () => void;

export type ErrorDialogContextParams = {
	error: ErrorDialogState | null;
	displayError: DisplayErrorFunction;
	clearError: ClearErrorFunction;
};

const ErrorDialogContext = createContext<ErrorDialogContextParams | null>(null);

export default ErrorDialogContext;
