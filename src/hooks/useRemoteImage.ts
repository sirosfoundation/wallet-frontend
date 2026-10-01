import { useEffect, useState } from 'react';
import { useHttpClient } from './useHttpClient';
import {
	sanitizeSvgDataUri,
	sanitizeSvgContent,
	isSvgDataUri,
} from '@/lib/utils/sanitizeSvg';
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
			let objectUrl: string | null = null;
			let active = true;

			(async () => {
				try {
					const res = await httpClient.get(
						uri,
						{},
						{ useCache: true, wantRaw: true },
					);
					if (!active || res.status !== 200) return;

					const contentType = String(
						res.headers?.['content-type'] ||
							res.headers?.['Content-Type'] ||
							'',
					);

					if (contentType.includes('svg')) {
						const svgText =
							typeof res.data === 'string'
								? res.data
								: new TextDecoder().decode(res.raw);
						const sanitizedSvg = sanitizeSvgContent(svgText);
						const encoded = btoa(
							new TextEncoder()
								.encode(sanitizedSvg)
								.reduce((data, byte) => data + String.fromCharCode(byte), ''),
						);
						setSrc(`data:image/svg+xml;base64,${encoded}`);
					} else if (contentType.startsWith('image/') && res.raw) {
						objectUrl = URL.createObjectURL(
							new Blob([new Uint8Array(res.raw)], { type: contentType }),
						);
						setSrc(objectUrl);
					} else if (typeof res.data === 'string') {
						setSrc(res.data);
					} else if (res.raw) {
						objectUrl = URL.createObjectURL(
							new Blob([new Uint8Array(res.raw)], {
								type: contentType || 'application/octet-stream',
							}),
						);
						setSrc(objectUrl);
					}
				} catch {
					if (active) setSrc(null);
				}
			})();

			return () => {
				active = false;
				if (objectUrl) URL.revokeObjectURL(objectUrl);
			};
		} else {
			logger.warn('Unsupported logo URI scheme:', uri);
			setSrc(null);
		}
	}, [uri, httpClient]);

	return src;
};
