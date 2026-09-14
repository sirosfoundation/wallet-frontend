export function getCredentialType(parsedCredential: any): string {
	return (
		parsedCredential?.metadata?.credential?.vct ??
		parsedCredential?.metadata?.credential?.doctype ??
		''
	);
}
