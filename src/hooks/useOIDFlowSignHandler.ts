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
import { MDoc } from '@auth0/mdl';
import { LocalStorageKeystore } from '@/services/LocalStorageKeystore';
import { cborDecode, cborEncode } from '@auth0/mdl/lib/cbor';
import { fromBase64Url } from '@/util';
import { encode as cborXEncode, decode as cborXDecode } from 'cbor-x';
import { 
    generateDeviceSignature, 
    buildZkpResponse, 
    signMdocWithPlaceholder,
    buildCombinedDeviceResponse,
    DEFAULT_PID_ZKP_CONFIG 
} from '@/utils/MdocZkpService';
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
	origin?: string;
	responseUri?: string;
	credentialsToInclude?: Array<{
		credentialId: string;
		credentialQueryId?: string;
		disclosedClaims?: string[];
		credentialRaw?: string;
	}>;
	verifierJwkThumbprint?: string;
	finalVP?: Uint8Array;
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
		const { audience, nonce, credentialsToInclude, responseUri, origin, verifierJwkThumbprint, finalVP } = options;
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

			if (!c.credentialQueryId) {
				throw new Error(`Missing credentialQueryId for credential: ${c.credentialId}`);
			}

			const vpToken = await createVpToken(
				keystore,
				{
					credentialRaw: c.credentialRaw,
					disclosedClaims: c.disclosedClaims,
				},
				{
					nonce,
					audience,
					responseUri,
					origin,
					verifierJwkThumbprint,
				},
				finalVP,
			);

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

async function createVpToken(
	keystore: LocalStorageKeystore,
	credentialData: {
		credentialRaw: string;
		disclosedClaims?: string[];
	},
	params: {
		nonce: string;
		audience: string;
		responseUri?: string;
		origin?: string;
		verifierJwkThumbprint?: string;
	},
	finalVP: Uint8Array,
) {
	const { credentialRaw, disclosedClaims } = credentialData;
	const { nonce, audience, responseUri, origin, verifierJwkThumbprint } = params;

	switch (detectCredentialFormat(credentialRaw)) {
			case VerifiableCredentialFormat.DC_SDJWT:
			case VerifiableCredentialFormat.VC_SDJWT:
			case VerifiableCredentialFormat.JWT_VC_JSON:
				return await createVpTokenFromSdJwt(
					keystore,
					{
						credentialRaw,
						disclosedClaims: disclosedClaims ?? [],
					},
					{
						nonce,
						audience,
					}
				);
			case VerifiableCredentialFormat.MSO_MDOC:
				return await createVpTokenFromMdoc(
					keystore,
					{
						credentialRaw,
						disclosedClaims: disclosedClaims ?? [],
					},
					{
						nonce,
						audience,
						responseUri,
						origin,
						verifierJwkThumbprint,
					},
					finalVP,
				);
			default:
				throw new Error('Unsupported credential format for presentation signing');
		}
}

async function createVpTokenFromSdJwt(
	keystore: LocalStorageKeystore,
	credentialData: {
		credentialRaw: string;
		disclosedClaims: string[];
	},
	params: {
		nonce: string;
		audience: string;
	}
): Promise<string> {
	const { credentialRaw, disclosedClaims } = credentialData;
	const { nonce, audience } = params;

	const credential = await applySelectiveDisclosure(credentialRaw, disclosedClaims);
	const { vpjwt } = await keystore.signJwtPresentation(nonce, audience, [credential]);
	return vpjwt;
}

async function createVpTokenFromMdoc(
	keystore: LocalStorageKeystore,
	credentialData: {
		credentialRaw: string;
		disclosedClaims: string[];
	},
	params: {
		nonce: string;
		audience: string;
		responseUri?: string;
		origin?: string;
		verifierJwkThumbprint?: string;
	},
    finalVP: { Transcript: string; ZKDeviceResponseCBOR: string; zkDocumentsArray: Uint8Array } | null,
): Promise<string> {
	const { credentialRaw, disclosedClaims } = credentialData;
	const { nonce, audience, responseUri, origin, verifierJwkThumbprint } = params;

	if (!responseUri && !origin) {
		throw new Error('Missing responseUri or origin for mdoc presentation');
	}

	if (responseUri && origin) {
		throw new Error('Both responseUri and origin provided for mdoc presentation, only one should be provided');
	}

	if (!disclosedClaims?.length) {
		throw new Error('disclosedClaims required for mdoc presentation');
	}

	//const mdoc = parseIssuerSignedToMDoc(credentialRaw);
	const data = credentialRaw;
	const bytes = fromBase64Url(data);
	const mdoc = cborDecode(bytes); 
	const docType =  "eu.europa.ec.eudi.pid.1";

	const presentationDefinition = buildMdocPresentationDefinition(
		docType,
		disclosedClaims ?? [],
	);

	let deviceResponseMDoc: MDoc;
	if (responseUri) {
		const { deviceResponseMDoc: drm } = await keystore.generateDeviceResponse(
			mdoc, presentationDefinition, nonce, audience, responseUri,
			verifierJwkThumbprint ?? null,
		);
		deviceResponseMDoc = drm;
	} else if (origin) {
		const { deviceResponseMDoc: drm } = await keystore.generateDeviceResponseForDCAPI(
			mdoc, presentationDefinition, nonce, origin,
			verifierJwkThumbprint ?? null,
		);
		deviceResponseMDoc = drm;
	} else {
		throw new Error('Unexpected error: neither responseUri nor origin provided for mdoc presentation');
	}

	const versionKey = new Uint8Array([0x67, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e]); // "version"
	const versionVal = new Uint8Array([0x63, 0x31, 0x2e, 0x30]); // "1.0"
	const statusKey = new Uint8Array([0x66, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73]); // "status"
	const statusVal = new Uint8Array([0x00]); // 0
	const zkDocsKey = new Uint8Array([0x6b, 0x7a, 0x6b, 0x44, 0x6f, 0x63, 0x75, 0x6d, 0x65, 0x6e, 0x74, 0x73]); // "zkDocuments"

	const combined = buildCombinedDeviceResponse(finalVP.zkDocumentsArray);
	return base64url.encode(combined);
}
