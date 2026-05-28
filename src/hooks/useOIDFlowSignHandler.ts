import { useContext, useCallback } from 'react';
import SessionContext from '@/context/SessionContext';
import { useApi } from '@/api';
import StatusContext from '@/context/StatusContext';
import { logger } from '@/logger';
import { OPENID4VCI_PROOF_TYPE_PRECEDENCE } from '@/config';
import { applySelectiveDisclosure } from '@/lib/sd-jwt/sd-jwt';
import { base64url } from 'jose';
import { buildMdocPresentationDefinition, parseIssuerSignedToMDoc } from '@/lib/mdoc/mdoc';
import { detectCredentialFormat, VerifiableCredentialFormat } from 'wallet-common';

interface ProofTypeConfig {
	key_attestations_required?: Record<string, unknown> | null;
	proof_signing_alg_values_supported: string[];
}

interface ProofTypesSupported {
	jwt?: ProofTypeConfig;
	attestation?: ProofTypeConfig;
	cwt?: ProofTypeConfig;
}

export type OIDFlowSignOptions = {
	audience?: string;
	nonce?: string;
	issuer?: string;
	proofType?: string;
	proofTypesSupported?: ProofTypesSupported;
	count?: number;
	credentialsToInclude?: Array<{
		credentialId: string;
		credentialQueryId?: string;
		disclosedClaims?: string[];
		credentialRaw?: string;
	}>;
	responseUri?: string;
	verifierJwkThumbprint?: string;
}

export interface OIDFlowSignRequest {
	action: 'generate_proof' | 'sign_presentation';
	params: OIDFlowSignOptions;
}

/**
 * Individual proof object for OID4VCI
 */
export interface ProofObject {
	proof_type: 'jwt' | 'cwt' | 'attestation';
	jwt?: string;
	cwt?: string;
	attestation?: string;
}

/**
 * Sign response to send back to server
 */
export interface OIDFlowSignResponse {
	proofJwt?: string;       // single proof (legacy)
	proofs?: ProofObject[];  // batch proofs
	vpToken?: string;
}

export function useOIDFlowSignHandler() {
	const sessionContext = useContext(SessionContext);
	const { isOnline } = useContext(StatusContext);
	const api = useApi(isOnline);

	const keystore = sessionContext?.keystore;

	const signPresentation = useCallback(async (options: OIDFlowSignOptions): Promise<OIDFlowSignResponse> => {
		const { audience, nonce, credentialsToInclude, responseUri, verifierJwkThumbprint } = options;
		if (!audience || !nonce) {
			throw new Error('Missing audience or nonce for presentation signing');
		}
		if (!credentialsToInclude?.length) {
			throw new Error('No credentials to include in presentation');
		}

		const vpTokenMap: Record<string, string[]> = {};
		for (const c of credentialsToInclude) {
			if (!c.credentialRaw) {
				throw new Error(`Credential not in cache: ${c.credentialId}`);
			}

			let vpToken: string;

			switch (detectCredentialFormat(c.credentialRaw)) {
				case VerifiableCredentialFormat.DC_SDJWT:
				case VerifiableCredentialFormat.VC_SDJWT:
				case VerifiableCredentialFormat.JWT_VC_JSON: {
					const credential = await applySelectiveDisclosure(c.credentialRaw, c.disclosedClaims ?? []);
					const { vpjwt } = await keystore.signJwtPresentation(nonce, audience, [credential]);
					vpToken = vpjwt;
					break;
				}
				case VerifiableCredentialFormat.MSO_MDOC: {
					if (!responseUri) {
						throw new Error('Missing responseUri for mdoc presentation');
					}

					if (!c.disclosedClaims?.length) {
						throw new Error('disclosedClaims required for mdoc presentation');
					}


					const mdoc = parseIssuerSignedToMDoc(c.credentialRaw);
					const presentationDefinition = buildMdocPresentationDefinition(
						mdoc.documents[0].docType,
						c.disclosedClaims ?? [],
					);

					const { deviceResponseMDoc } = await keystore.generateDeviceResponse(
						mdoc, presentationDefinition, nonce, audience, responseUri,
						verifierJwkThumbprint ?? null,
					);

					vpToken = base64url.encode(new Uint8Array(deviceResponseMDoc.encode()));
					break;
				}
				default: {
					throw new Error('Unsupported credential format for presentation signing');
				}
			}

			if (!c.credentialQueryId) {
				throw new Error(`Missing credentialQueryId for credential: ${c.credentialId}`);
			}

			vpTokenMap[c.credentialQueryId] = [vpToken];
		}

		logger.debug(`[WS Sign Handler] Signed VP token(s) for ${Object.keys(vpTokenMap).length} query/queries`);

		return {
			vpToken: JSON.stringify(vpTokenMap)
		};
	}, [keystore]);

	const generateProof = useCallback(async (options: OIDFlowSignOptions): Promise<OIDFlowSignResponse> => {
		const { audience, nonce, proofTypesSupported, issuer, count = 1 } = options;
		if (!audience) {
			throw new Error('Missing audience for proof generation');
		}
		if (!proofTypesSupported) {
			throw new Error('Missing proofTypesSupported for proof generation');
		}

		// Select proof type
		const proofType = OPENID4VCI_PROOF_TYPE_PRECEDENCE
			.split(',')
			.find(type => proofTypesSupported[type]) as 'jwt' | 'attestation' | undefined;

		if (proofType === 'attestation') {
			const [{ keypairs }, newPrivateData, keystoreCommit] =
				await keystore.generateKeypairs(count);

			// Persist key changes
			await api.updatePrivateData(newPrivateData);
			await keystoreCommit();

			const response = await api.post('/wallet-provider/key-attestation/generate', {
				jwks: keypairs.map(kp => kp.publicKey),
				openid4vci: { nonce },
			});

			const keyAttestation = response.data?.key_attestation;
			if (!keyAttestation || typeof keyAttestation !== 'string') {
				throw new Error('Failed to get key attestation from wallet backend');
			}

			const proofs: ProofObject[] = [{ proof_type: 'attestation', attestation: keyAttestation }];

			logger.debug(`[WS Sign Handler] Generated attestation proof for ${count} key(s)`);
			return { proofs };
		}

		if (proofType === 'jwt') {
			// Generate multiple proofs based on count
			const requests = Array.from({ length: count }, () => ({
				nonce,
				audience,
				issuer,
			}));

			const [{ proof_jwts }, newPrivateData, keystoreCommit] =
				await keystore.generateOpenid4vciProofs(requests);

			// Persist key changes
			await api.updatePrivateData(newPrivateData);
			await keystoreCommit();

			const proofs: ProofObject[] = proof_jwts.map(jwt => ({
				proof_type: proofType,
				jwt,
			}));

			logger.debug(`[WS Sign Handler] Generated ${proofs.length} proof(s)`);
			return { proofs };
		}

		throw new Error(`Unsupported proof type requested: ${proofType}`);
	}, [keystore, api]);

	const handleSignRequest = useCallback(async (request: OIDFlowSignRequest): Promise<OIDFlowSignResponse> => {
		if (!keystore) {
			throw new Error('Keystore not available');
		}

		logger.debug('[WS Sign Handler] Received sign request:', request.action);

		switch (request.action) {
			case 'generate_proof':
				return await generateProof(request.params);
			case 'sign_presentation':
				return await signPresentation(request.params);
			default:
				throw new Error(`Unknown sign action: ${request.action}`);
		}
	}, [keystore, generateProof, signPresentation]);

	return { handleSignRequest, signPresentation, generateProof };
}
