export const prettyDomain = (raw: string | undefined) => {
	if (!raw) return '';
	let value = raw.trim();

	if (value.startsWith('did:web:')) {
		const [host] = value.slice(8).split(':');
		value = decodeURIComponent(host);
	} else {
		value = value
			.replace(/^origin:/, '')
			.replace(/^x509_san_dns:/, '')
			.replace(/^san_dns_x509:/, '')
			.replace(/^did:[^:]+:/, '');
	}

	try {
		const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
		const url = new URL(hasScheme ? value : `https://${value}`);
		return url.host || value;
	} catch {
		return value;
	}
};
