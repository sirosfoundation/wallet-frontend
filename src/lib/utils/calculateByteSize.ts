/** Return the byte length of `s` in the UTF-8 encoding. */
export function calculateByteSize(s: string): number {
	const encoder = new TextEncoder();
	const encoded = encoder.encode(s);
	return encoded.length;
};
