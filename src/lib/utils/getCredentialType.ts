// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
export function getCredentialType(parsedCredential: any): string {
	return (
		parsedCredential?.metadata?.credential?.vct ??
		parsedCredential?.metadata?.credential?.doctype ??
		''
	);
}
