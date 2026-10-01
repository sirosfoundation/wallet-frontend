/**
 * Check if the browser supports the previewSign FIDO2 extension.
 */
export async function browserSupportsPreviewSign(): Promise<boolean> {
	if (
		typeof PublicKeyCredential === 'undefined' ||
		typeof PublicKeyCredential.getClientCapabilities !== 'function'
	) return false;

	const caps = await PublicKeyCredential.getClientCapabilities();

	const hasSignExtension = (
		'extension:sign' in caps &&
		caps['extension:sign'] === true
	);

	return hasSignExtension;
}
