import { useEffect, useState } from 'react';
import { useHttpClient } from './useHttpClient';
import { sanitizeSvgDataUri, sanitizeSvgContent, isSvgDataUri } from '@/lib/utils/sanitizeSvg';
import { logger } from '@/logger';

export const useRemoteImage = (uri?: string | null) => {
	const httpClient = useHttpClient();
	const [src, setSrc] = useState<string | null>(null);

	useEffect(() => {
		if (!uri || typeof uri !== 'string' || !uri.trim()) {
			setSrc(null);
			return;
		}

		// Handle data URIs directly (e.g. data:image/svg+xml;base64,...)
		if (uri.startsWith('data:')) {
			// Sanitize SVG data URIs to prevent XSS
			if (isSvgDataUri(uri)) {
				const sanitized = sanitizeSvgDataUri(uri);
				setSrc(sanitized);
			} else {
				setSrc(uri);
			}
			return;
		}

		// Handle HTTPS or HTTP fetch
		if (uri.startsWith('http')) {
			(async () => {
				try {
					const res = await httpClient.get(uri, {}, { useCache: true });
					if (res.status === 200 && typeof res.data === 'string') {
						const contentType = String(
							res.headers?.['content-type'] || res.headers?.['Content-Type'] || '',
						);

						if (contentType.includes('svg')) {
							// Sanitize SVG content before encoding
							const sanitizedSvg = sanitizeSvgContent(res.data);
							const encoded = btoa(
								new TextEncoder()
									.encode(sanitizedSvg)
									.reduce((data, byte) => data + String.fromCharCode(byte), ''),
							);
							setSrc(`data:image/svg+xml;base64,${encoded}`);
						} else {
							setSrc(res.data);
						}
					}
				} catch {
					setSrc(null);
				}
			})();
		} else {
			logger.warn('Unsupported logo URI scheme:', uri);
			setSrc(null);
		}
	}, [uri, httpClient]);

	return src;
};
