import { fromBase64Url, isBase64, base64UrlToBase64 } from './binary';

type MimeBytes = { offset: number; signature: number[] };

type MimeByteSignatures = Record<string, MimeBytes | MimeBytes[]>;

const BYTE_MIME_SIGNATURES: MimeByteSignatures = {
	'image/png': {
		offset: 0,
		signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
	},
	'image/jpeg': { offset: 0, signature: [0xff, 0xd8, 0xff] },
	'image/gif': { offset: 0, signature: [0x47, 0x49, 0x46, 0x38] },
	'image/webp': [
		{ offset: 0, signature: [0x52, 0x49, 0x46, 0x46] },
		{ offset: 8, signature: [0x57, 0x45, 0x42, 0x50] },
	],
	'image/bmp': { offset: 0, signature: [0x42, 0x4d] },
};

/**
 * Detects the MIME type of an image based on its byte signature.
 */
export function detectImageMimeFromBytes(
	bytes: Uint8Array<ArrayBufferLike>,
): string | null {
	for (const [mime, value] of Object.entries(BYTE_MIME_SIGNATURES)) {
		const segments = Array.isArray(value) ? value : [value];

		const matches = segments.every(
			({ offset, signature }) =>
				bytes.length >= offset + signature.length &&
				signature.every((byte, index) => bytes[index + offset] === byte),
		);

		if (matches) return mime;
	}

	return null;
}

/**
 * Ensures that a given string is a valid image data URI.
 * If the input is a bare base64 string, it attempts to infer the MIME type
 * and convert it into a data URI.
 */
export function ensureStringIsImageDataUri(input: string): string | null {
	try {
		const isPrefixed = !/^(data:)?image\/[a-zA-Z]+;base64,/.test(input);
		if (isPrefixed) {
			const normalized = base64UrlToBase64(input);
			if (!isBase64(normalized)) return null;

			const mime = detectImageMimeFromBytes(fromBase64Url(normalized));
			if (!mime) return null;

			input = `data:${mime};base64,${normalized}`;
		}

		const isDataLess = !input.startsWith('data:');
		if (isDataLess) input = `data:${input}`;

		return /^data:image\/[a-zA-Z]+;base64,/.test(input) ? input : null;
	} catch {
		// returning null like this is a discouraged
		// practice, generally speaking. however here,
		// we are intentionally swallowing any errors that occur
		// during the processing of the input string and returning null.
		return null;
	}
}
