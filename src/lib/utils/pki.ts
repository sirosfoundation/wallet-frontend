import { fromBER } from 'asn1js';
// biome-ignore lint/performance/noNamespaceImport: baseline: pre-existing debt. should be fixed
import * as jose from 'jose';
// biome-ignore lint/performance/noNamespaceImport: baseline: pre-existing debt. should be fixed
import * as pkijs from 'pkijs';
import { CertificateChainValidationEngine } from 'pkijs';

// Assuming `certPEM` is a PEM-encoded certificate string
const pemToBinary = (pem) => {
	const b64 = pem.replace(/(-----(BEGIN|END) CERTIFICATE-----|\s)/g, '');
	const binaryString = atob(b64);
	// Convert to ArrayBuffer
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
};

// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
export async function extractSAN(pemCert: string): Promise<string[] | null> {
	const derCert = pemToBinary(pemCert);

	const asn1 = fromBER(derCert);
	if (asn1.offset === -1) {
		throw new Error('Error parsing ASN.1 structure');
	}

	const cert = new pkijs.Certificate({ schema: asn1.result });
	if (!cert.extensions) {
		return null;
	}
	const sanExtension = cert.extensions.find((ext) => ext.extnID === '2.5.29.17'); // OID for SAN
	// biome-ignore lint/complexity/useLiteralKeys: baseline: pre-existing debt. should be fixed
	if (sanExtension.parsedValue['altNames']) {
		// biome-ignore lint/complexity/useLiteralKeys: baseline: pre-existing debt. should be fixed
		return sanExtension.parsedValue['altNames'].map((altName) => altName.value);
	}
	return null;
}

export function fromPemToPKIJSCertificate(pem) {
	const certBuffer = pemToBinary(pem);
	const asn1 = fromBER(certBuffer);
	return new pkijs.Certificate({ schema: asn1.result });
}

export function getPublicKeyFromB64Cert(certBase64) {
	const certPEM = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
	return certPEM;
}

export function toPem(b64Cert: string) {
	return `-----BEGIN CERTIFICATE-----\n${b64Cert}\n-----END CERTIFICATE-----`;
}

export async function validateChain(certChain: pkijs.Certificate[], trustAnchorCerts: string[]) {
	const certChainValidationEngine = new CertificateChainValidationEngine({
		trustedCerts: trustAnchorCerts.map((c) => fromPemToPKIJSCertificate(c)), // Trusted root certificates
		certs: certChain, // The certificate chain to validate
	});

	try {
		const result = await certChainValidationEngine.verify();
		return result.result;
		// biome-ignore lint/complexity/noUselessCatchBinding: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
	} catch (error) {
		return false;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
export function binaryToPem(binaryData: any) {
	// Convert ArrayBuffer to Uint8Array
	const byteArray = new Uint8Array(binaryData);
	let binaryString = '';
	// Iterate through the byte array and build a binary string
	for (let i = 0; i < byteArray.length; i++) {
		binaryString += String.fromCharCode(byteArray[i]);
	}

	// Convert the binary string to a base64 encoded string
	const base64String = btoa(binaryString);

	// Split the base64 string into 64-character lines
	const lineLength = 64;
	let pemString = '';
	for (let i = 0; i < base64String.length; i += lineLength) {
		// biome-ignore lint/style/useTemplate: baseline: pre-existing debt. should be fixed
		pemString += base64String.slice(i, i + lineLength) + '\n';
	}

	// Add the PEM header and footer
	pemString = `-----BEGIN CERTIFICATE-----\n${pemString}-----END CERTIFICATE-----`;

	return pemString;
}

export async function importCert(cert: string) {
	// convert issuer cert to KeyLike
	const issuerCertJose = await jose.importX509(cert, 'ES256', { extractable: true });
	// convert issuer cert from KeyLike to JWK
	const issuerCertJwk = await jose.exportJWK(issuerCertJose);
	// import issuer cert from JWK to CryptoKey
	const importedCert = await crypto.subtle.importKey(
		'jwk',
		issuerCertJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['verify'],
	);
	return importedCert;
}

export function fromDerToPKIJSCertificate(der) {
	const asn1 = fromBER(der);
	return new pkijs.Certificate({ schema: asn1.result });
}
