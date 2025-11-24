import { Core } from "@wwwallet/client-core";

export type ProtocolResponse = Exclude<Awaited<ReturnType<InstanceType<typeof Core>['location']>>, { protocol: null }>;

export type ProtocolData = ProtocolResponse['data']

export type ProtocolStep =
	| "authorization_request"
	| "authorize"
	| "generate_presentation"
	| "send_presentation"
	| "presentation_success"
	| "protocol_error"
	| "credential_request"
	| "error"
