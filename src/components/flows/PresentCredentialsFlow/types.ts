export type PresentCredentialsVerifier = {
	name: string;
	domain: string;
	logo?: string;
};

export type PresentCredentialsQuery = {
	id: string;
	matches: Array<{
		batchId: number;
		display: {
			name: string;
			backgroundColor?: string;
			textColor?: string;
			logo?: string;
		};
		fields: Array<{
			name: string;
			value: unknown;
		}>;
	}>;
};

export type PresentCredentialSet = {
	purpose?: string;
	required?: boolean;
	options: string[][];
};

export type PresentCredentialsRequest = {
	verifier: PresentCredentialsVerifier;
	queries: PresentCredentialsQuery[];
	sets: PresentCredentialSet[];
};

export type PresentCredentialsResult = Array<{
	queryId: string;
	batchId: number;
}>;

export type PresentationResult = {
	verifierName: string;
	redirectUri?: string;
};

export type PresentationErrorState = {
	title: string;
	description: string;
	err?: Error;
	onClose: () => void;
};

export type ConformantCredentials = Map<
	string,
	{
		credentials: number[];
		requestedFields: Array<{
			name?: string;
			path?: string[];
		}>;
	}
>;

export type CredentialSelection = {
	selected: Map<string, number>;
};

export type PresentCredentialsFlowView =
	| { status: 'loading' }
	| {
			status: 'request';
			request: PresentCredentialsRequest;
			onAccept: (result: PresentCredentialsResult) => void;
			onDecline: () => void;
	}
	| { status: 'sharing'; onCancel?: () => void }
	| { status: 'shared'; result: PresentationResult }
	| { status: 'error'; state: PresentationErrorState };
