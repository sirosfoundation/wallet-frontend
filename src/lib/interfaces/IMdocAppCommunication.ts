export interface IMdocAppCommunication {
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	generateEngagementQR(credential: any): Promise<string>;
	startClient(): Promise<boolean>;
	getMdocRequest(): Promise<string[]>;
	sendMdocResponse(): Promise<void>;
	terminateSession(): Promise<void>;
}
