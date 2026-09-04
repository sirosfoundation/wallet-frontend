import { useContext, useCallback } from 'react';
import SessionContext from '@/context/SessionContext';
import { useApi } from '@/api';
import StatusContext from '@/context/StatusContext';
import { logger } from '@/logger';
import { OPENID4VCI_PROOF_TYPE_PRECEDENCE, WIA_ENABLED, BACKEND_URL } from '@/config';
import { generateFlowAttestation } from '@/lib/services/OpenID4VCI/WIA';
import { base64url } from 'jose';
import {
	applySelectiveDisclosure,
	buildMdocPresentationDefinition,
	extractIssuerSignedB64,
	parseIssuerSignedToMDoc,
} from '@/lib/verifiable-credentials';
import { detectCredentialFormat, VerifiableCredentialFormat } from 'wallet-common';
import { MDoc } from '@auth0/mdl';
import { LocalStorageKeystore } from '@/services/LocalStorageKeystore';


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
}

export interface OIDFlowSignRequest {
	action: 'generate_proof' | 'sign_presentation' | 'request_attestation';
	params: OIDFlowSignOptions;
}

/**
 * Individual proof object for OID4VCI
 */
interface ProofObjectJwt {
	proof_type: 'jwt';
	jwt: string;
}
interface ProofObjectCwt {
	proof_type: 'cwt';
	cwt: string;
}
interface ProofObjectAttestation {
	proof_type: 'attestation';
	attestation: string;
}
export type ProofObject = ProofObjectJwt | ProofObjectCwt | ProofObjectAttestation;

/**
 * Sign response to send back to server
 */
export interface OIDFlowSignResponse {
	proofJwt?: string;       // single proof (legacy)
	proofs?: ProofObject[];  // batch proofs
	vpToken?: string;
	clientAttestation?: string;
	clientAttestationPoP?: string;
}

export function useOIDFlowSignHandler() {
	const sessionContext = useContext(SessionContext);
	const { isOnline } = useContext(StatusContext);
	const api = useApi(isOnline);

	const keystore = sessionContext?.keystore;

	const signPresentation = useCallback(async (options: OIDFlowSignOptions): Promise<OIDFlowSignResponse> => {
		const { audience, nonce, credentialsToInclude, responseUri, origin, verifierJwkThumbprint } = options;
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
				}
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

	const generateClientAttestation = useCallback(async (
		options: OIDFlowSignOptions,
	): Promise<OIDFlowSignResponse> => {
		// Engine-driven Wallet Instance Attestation (Tier 3). The backend sends
		// a `request_attestation` sign_request once it has resolved the issuer's
		// authorization server, so the wallet never parses the credential offer
		// itself (avoids a CORS-bound fetch from the browser).
		//
		// KNOWN LIMITATIONS (documented, not fixed):
		//
		// - the engine requests the
		//   attestation once and replays the same WIA + PoP on both the PAR and
		//   token requests (and any DPoP-nonce retry). An AS that enforces a
		//   single-use PoP `jti` would reject the second use.
		//
		// - the WIA `cnf` key is a fresh
		//   key minted inside generateFlowAttestation, NOT the DPoP key the engine
		//   binds the token to (that key is engine-side over WebSocket). So
		//   `cnf` != DPoP key, and strict EC TS03 §2.2.1.1 key binding is not
		//   satisfied on this transport.
		const { audience, issuer } = options;

		if (!audience || !issuer) return {};

		return await generateFlowAttestation(
			api.post,
			WIA_ENABLED,
			issuer,
			audience,
			BACKEND_URL,
		);
	}, [api]);

	const handleSignRequest = useCallback(async (request: OIDFlowSignRequest): Promise<OIDFlowSignResponse> => {
		logger.debug('[WS Sign Handler] Received sign request:', request.action);

		if (!keystore) throw new Error('Keystore not available');

		switch (request.action) {
			case 'request_attestation':
				return await generateClientAttestation(request.params);
			case 'generate_proof':
				return await generateProof(request.params);
			case 'sign_presentation':
				return await signPresentation(request.params);
			default:
				throw new Error(`Unknown sign action: ${request.action}`);
		}
	}, [keystore, generateProof, signPresentation, generateClientAttestation]);

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
	}
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
					}
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
	}
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
	// The stored credential may be a full DeviceResponse envelope, or a bare
	// IssuerSigned structure directly (what real-world/interop issuers, e.g.
	// geneva2026.mdoc.online, send for mso_mdoc credential responses) - in
	// the latter case it already *is* the issuerSigned structure.
	//
	// Decode with mdl's codec, never cbor-x's defaults. cbor-x decodes maps
	// to plain objects, whose keys can only be strings, so a decode/encode
	// round-trip silently rewrites COSE's integer header labels as decimal
	// strings - issuerAuth's x5chain label 33 becomes "33". Byte strings
	// survive, so the damage is invisible until a verifier looks for the
	// certificate chain and reports the credential as having none. The
	// unprotected header is not covered by the COSE signature, so nothing
	// upstream of that verifier notices.
	const issuerSignedB64 = extractIssuerSignedB64(credentialRaw);
	const mdoc = parseIssuerSignedToMDoc(issuerSignedB64);
	const presentationDefinition = buildMdocPresentationDefinition(
		mdoc.documents[0].docType,
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

	return base64url.encode(new Uint8Array(deviceResponseMDoc.encode()));
}
