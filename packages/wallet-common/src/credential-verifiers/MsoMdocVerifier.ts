import {
	DataItem,
	type DeviceSignedDocument,
	type IssuerSignedDocument,
	type MDoc,
	parse,
	Verifier,
} from '@auth0/mdl';
import { cborDecode, cborEncode } from '@auth0/mdl/lib/cbor/';
import type { IssuerSigned } from '@auth0/mdl/lib/mdoc/model/types';
import { COSEKeyToJWK } from 'cose-kit';
import type { JWK } from 'jose';
import { CredentialVerificationError } from '../error';
import type { Context, CredentialVerifier, PublicKeyResolverEngineI } from '../interfaces';
import { fromBase64Url } from '../utils/util';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export function MsoMdocVerifier(args: {
	context: Context;
	pkResolverEngine: PublicKeyResolverEngineI;
}): CredentialVerifier {
	let errors: { error: CredentialVerificationError; message: string }[] = [];
	const logError = (error: CredentialVerificationError, message: string): void => {
		errors.push({ error, message });
	};

	// Note: The verifier is only used when delegateTrustToBackend is false (legacy mode)
	// Trust evaluation is now delegated to AuthZEN at the protocol level
	const verifier = new Verifier(
		(args.context.trustedCertificates ?? []).map(
			(crt) => `-----BEGIN CERTIFICATE-----\n${crt}\n-----END CERTIFICATE-----`,
		),
	);

	const getSessionTranscriptBytesForOID4VPHandover = async (
		clId: string,
		respUri: string,
		nonce: string,
		mdocNonce: string,
	) =>
		cborEncode(
			DataItem.fromData([
				null,
				null,
				[
					await args.context.subtle.digest(
						'SHA-256',
						new Uint8Array(cborEncode([clId, mdocNonce])),
					),
					await args.context.subtle.digest(
						'SHA-256',
						new Uint8Array(cborEncode([respUri, mdocNonce])),
					),
					nonce,
				],
			]),
		);

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	async function expirationCheck(
		issuerSigned: IssuerSigned,
	): Promise<null | CredentialVerificationError.ExpiredCredential> {
		// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
		const { validFrom, validUntil, signed } = issuerSigned.issuerAuth.decodedPayload.validityInfo;
		if (
			Math.floor(validUntil.getTime() / 1000) + args.context.clockTolerance <
			// biome-ignore lint/complexity/useDateNow: baseline: pre-existing debt. should be fixed
			Math.floor(new Date().getTime() / 1000)
		) {
			logError(CredentialVerificationError.ExpiredCredential, 'Credential is expired');
			return CredentialVerificationError.ExpiredCredential;
		}
		return null;
	}

	function extractHolderPublicKeyJwk(parsedDocument: IssuerSignedDocument): JWK | null {
		// biome-ignore lint/suspicious/noDoubleEquals: baseline: pre-existing debt. should be fixed
		if (parsedDocument.issuerSigned.issuerAuth.decodedPayload.deviceKeyInfo == undefined) {
			logError(
				CredentialVerificationError.MsoMdocMissingDeviceKeyInfo,
				// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
				'MsoMdocMissingDeviceKeyInfo',
			);
			return null;
		}

		const cosePublicKey =
			parsedDocument.issuerSigned.issuerAuth.decodedPayload.deviceKeyInfo.deviceKey;
		const holderPublicKeyJwk = COSEKeyToJWK(cosePublicKey);
		return holderPublicKeyJwk as JWK;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline: pre-existing debt. should be fixed
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
	async function issuerSignedCheck(
		rawCredential: string,
	): Promise<{ holderPublicKeyJwk: JWK | null }> {
		try {
			const credentialBytes = fromBase64Url(rawCredential);
			const issuerSigned: Map<string, unknown> = cborDecode(credentialBytes);
			// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
			const [header, _, payload, sig] = issuerSigned.get('issuerAuth') as Array<Uint8Array>;
			const decodedIssuerAuthPayload: DataItem = cborDecode(payload);
			const docType = decodedIssuerAuthPayload.data.get('docType');
			const m = {
				version: '1.0',
				documents: [
					new Map([
						['docType', docType],
						['issuerSigned', issuerSigned],
					]),
				],
				status: 0,
			};
			const encoded = cborEncode(m);
			const mdoc = parse(encoded);
			const [parsedDocument] = mdoc.documents;
			const expirationCheckRes = await expirationCheck(parsedDocument.issuerSigned);
			if (expirationCheckRes !== null) {
				return { holderPublicKeyJwk: null };
			}

			// Only validate certificate chain if not delegating to backend
			// Trust evaluation is now delegated to AuthZEN at the protocol level
			const delegateTrustToBackend = args.context.delegateTrustToBackend ?? true;
			const trustedCertificates = args.context.trustedCertificates ?? [];

			if (
				parsedDocument.issuerSigned.issuerAuth.x5chain &&
				!delegateTrustToBackend &&
				trustedCertificates.length > 0
			) {
				const { publicKey } =
					await parsedDocument.issuerSigned.issuerAuth.verifyX509Chain(trustedCertificates);
				if (!publicKey) {
					logError(CredentialVerificationError.NotTrustedIssuer, 'Issuer is not trusted');
					return { holderPublicKeyJwk: null };
				}
				const verification = await parsedDocument.issuerSigned.issuerAuth.verify(publicKey);
				if (verification !== true) {
					logError(CredentialVerificationError.InvalidSignature, 'Invalid signature');
				}
				const holderPublicKeyJwk = extractHolderPublicKeyJwk(parsedDocument);

				return {
					holderPublicKeyJwk,
				};
			}
			const holderPublicKeyJwk = extractHolderPublicKeyJwk(parsedDocument);

			return {
				holderPublicKeyJwk,
			};
		} catch (err) {
			// @ts-expect-error
			// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
			if (err?.name && err.name === 'X509InvalidCertificateChain') {
				logError(
					CredentialVerificationError.InvalidCertificateChain,
					// biome-ignore lint/style/useTemplate: baseline: pre-existing debt. should be fixed
					'Invalid Certificate chain: ' + JSON.stringify(err),
				);
			}
		}
		return { holderPublicKeyJwk: null };
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline: pre-existing debt. should be fixed
	async function deviceResponseCheck(
		mdoc: MDoc,
		opts: {
			expectedNonce?: string;
			expectedAudience?: string;
			holderNonce?: string;
			responseUri?: string;
		},
	): Promise<{ holderPublicKeyJwk: JWK | null }> {
		try {
			const [parsedDocument] = mdoc.documents as DeviceSignedDocument[];
			if (!parsedDocument.deviceSigned) {
				// not a DeviceResponse
				return { holderPublicKeyJwk: null };
			}

			// Only validate certificate chain if not delegating to backend
			// Trust evaluation is now delegated to AuthZEN at the protocol level
			const delegateTrustToBackend = args.context.delegateTrustToBackend ?? true;
			const trustedCertificates = args.context.trustedCertificates ?? [];

			if (!delegateTrustToBackend && trustedCertificates.length > 0) {
				const res = await parsedDocument.issuerSigned.issuerAuth.verifyX509(trustedCertificates);
				if (!res) {
					logError(CredentialVerificationError.NotTrustedIssuer, 'Issuer is not trusted');
					return { holderPublicKeyJwk: null };
				}
			}

			const expiredResult = await expirationCheck(parsedDocument.issuerSigned);
			if (expiredResult) {
				return { holderPublicKeyJwk: null };
			}

			const holderPublicKeyJwk = extractHolderPublicKeyJwk(parsedDocument);

			if (opts.expectedAudience && opts.responseUri && opts.expectedNonce && opts.holderNonce) {
				await verifier.verify(mdoc.encode(), {
					encodedSessionTranscript: await getSessionTranscriptBytesForOID4VPHandover(
						opts.expectedAudience,
						opts.responseUri,
						opts.expectedNonce,
						opts.holderNonce,
					),
				});
				return { holderPublicKeyJwk };
			}

			return { holderPublicKeyJwk: holderPublicKeyJwk };
		} catch (err) {
			if (err instanceof Error) {
				// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
				if (err.name === 'X509InvalidCertificateChain') {
					logError(CredentialVerificationError.NotTrustedIssuer, 'Issuer is not trusted');
					return { holderPublicKeyJwk: null };
				} else if (err.name === 'MDLError') {
					logError(CredentialVerificationError.InvalidSignature, `MDLError: ${err.message}`);
				} else {
					// biome-ignore lint/suspicious/noConsole: baseline: pre-existing debt. should be fixed
					console.error(err);
				}
			}
			return { holderPublicKeyJwk: null };
		}
	}

	return {
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline: pre-existing debt. should be fixed
		async verify({ rawCredential, opts }) {
			errors = []; // re-initialize error array
			if (typeof rawCredential !== 'string') {
				return {
					success: false,
					error: CredentialVerificationError.InvalidDatatype,
				};
			}

			try {
				const decodedCred = fromBase64Url(rawCredential);
				const parsedMDOC = parse(decodedCred);
				const { holderPublicKeyJwk } = await deviceResponseCheck(parsedMDOC, opts);

				if (errors.length === 0 && holderPublicKeyJwk !== null) {
					return {
						success: true,
						value: {
							holderPublicKey: holderPublicKeyJwk,
						},
					};
				}

				if (errors.length > 0) {
					return {
						success: false,
						error: errors.length > 0 ? errors[0].error : CredentialVerificationError.UnknownProblem,
					};
				}
				// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
				// biome-ignore lint/complexity/noUselessCatchBinding: baseline: pre-existing debt. should be fixed
			} catch (err) {
				const { holderPublicKeyJwk } = await issuerSignedCheck(rawCredential);
				if (errors.length === 0 && holderPublicKeyJwk !== null) {
					return {
						success: true,
						value: {
							holderPublicKey: holderPublicKeyJwk,
						},
					};
				}

				if (errors.length > 0) {
					return {
						success: false,
						error: errors.length > 0 ? errors[0].error : CredentialVerificationError.UnknownProblem,
					};
				}
			}

			return {
				success: false,
				error: CredentialVerificationError.UnknownProblem,
			};
		},
	};
}
