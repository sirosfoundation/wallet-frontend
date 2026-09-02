import { VerifiableCredentialFormat } from 'wallet-common';
import * as jose from 'jose';
import { fromBase64Url } from '@/util';
import { cborDecode } from '@auth0/mdl/lib/cbor';
import { COSEKeyToJWK } from 'cose-kit';

export async function deriveHolderKidFromCredential(
	credential: string,
	format: VerifiableCredentialFormat,
): Promise<string | undefined> {
	switch (format) {
		case VerifiableCredentialFormat.VC_SDJWT:
		case VerifiableCredentialFormat.DC_SDJWT:
		case VerifiableCredentialFormat.JWT_VC_JSON: {
			const payload = credential.split('.')[1];
			if (!payload) {
				return undefined;
			}
			try {
				const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
				const cnf = decoded.cnf as { jwk?: jose.JWK } | undefined;
				if (cnf?.jwk) {
					return jose.calculateJwkThumbprint(cnf.jwk, 'sha256');
				}
			} catch {
				return undefined;
			}
			return undefined;
		}
		case VerifiableCredentialFormat.MSO_MDOC: {
			const credentialBytes = fromBase64Url(credential);
			const mdoc = cborDecode(credentialBytes);
			const fullMdocDocument = mdoc.get('documents');
			const msoBinaryRaw = (() => {
				if (fullMdocDocument) {
					const issuerSigned = fullMdocDocument[0].get('issuerSigned');
					const issuerAuth = issuerSigned.get('issuerAuth');
					return issuerAuth[2];
				}

				const issuerAuth = mdoc.get('issuerAuth');
				return issuerAuth[2];
			})();
			let msoBinary;
			if (msoBinaryRaw instanceof Uint8Array) {
				msoBinary = msoBinaryRaw;
			} else if (msoBinaryRaw instanceof ArrayBuffer) {
				msoBinary = new Uint8Array(msoBinaryRaw);
			} else {
				msoBinary = new Uint8Array(
					msoBinaryRaw.buffer,
					msoBinaryRaw.byteOffset || 0,
					msoBinaryRaw.byteLength || msoBinaryRaw.length,
				);
			}
			if (msoBinary && msoBinary.length > 0) {
				try {
					const msoData = cborDecode(msoBinary);
					const deviceKeyInfo = msoData.data.get('deviceKeyInfo');
					const deviceKey = deviceKeyInfo.get('deviceKey');
					const devicePublicKeyJwk = COSEKeyToJWK(deviceKey);
					const kid = await jose.calculateJwkThumbprint(devicePublicKeyJwk, 'sha256');

					return kid;
				} catch (e) {
					console.log('Failed to decode MSO:', e);
				}
			}
		}
	}
}
