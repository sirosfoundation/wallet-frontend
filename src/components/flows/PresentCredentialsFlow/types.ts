/**
 * Information about the verifier requesting credentials.
 */
export type PresentCredentialsVerifier = {
	name: string;
	domain: string;
	logo?: string;
};


/**
 * A single query for credentials, including the requested credential ID
 * and the matching credentials in the wallet.
 *
 * Typically this would be used like `PresentCredentialsQuery[]`.
 */
export type PresentCredentialsQuery = {
	id: string;
	matches: PresentCredentialsMatch[];
};
export type PresentCredentialsMatch = {
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
    pseudonymSeedHex?: string; 
};
/**
 * A single credential set, derived from the request's DCQL query.
 */
export type PresentCredentialSet = {
	purpose?: string;
	required?: boolean;
	options: string[][];
};

/**
 * A full request for presenting credentials, including the verifier information,
 * the requested queries, and the credential sets.
 */
export type PresentCredentialsRequest = {
	verifier: PresentCredentialsVerifier;
	queries: PresentCredentialsQuery[];
	sets: PresentCredentialSet[];
};

/**
 * The user-selected credentials to present.
 */
export type PresentCredentialsResult = Array<{
	queryId: string;
	batchId: number;
}>;

/**
 * The result of a successful presentation flow.
 */
export type PresentationResult = {
	verifierName: string;
	redirectUri?: string;
};

/**
 * The state of the presentation flow.
 */
export type PresentationErrorState = {
	title: string;
	description: string;
	err?: Error;
	onClose: () => void;
};

/**
 * A map of conformant credentials, keyed by the credential ID.
 */
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

/**
 * A map of selected credentials, keyed by the credential ID.
 *
 * @deprecated Unused. Selection state is tracked inline in the overview screen as
 * a `Record<queryId, batchId>`; this type is not referenced anywhere.
 */
export type CredentialSelection = {
	selected: Map<string, number>;
};

/**
 * The view state of the Present Credentials Flow.
 */
export type PresentCredentialsFlowView =
	| { status: 'loading' }
	| {
			status: 'request';
			request: PresentCredentialsRequest;
			onAccept: (result: PresentCredentialsResult) => void;
			onDecline: () => void;
	}
	| { status: 'sharing'; messages?: string[]; onCancel?: () => void }
	| { status: 'shared'; result: PresentationResult }
	| { status: 'error'; state: PresentationErrorState };
