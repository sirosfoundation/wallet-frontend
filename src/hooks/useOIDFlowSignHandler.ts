import { useContext, useCallback } from 'react';
import SessionContext from '@/context/SessionContext';
import { logger } from '@/logger';
import { OPENID4VCI_PROOF_TYPE_PRECEDENCE, WIA_ENABLED, BACKEND_URL } from '@/config';
import { base64url } from 'jose';
import {
	applySelectiveDisclosure,
} from '@/lib/verifiable-credentials';
import { detectCredentialFormat, VerifiableCredentialFormat } from 'wallet-common';
import { attestFlowIfEnabled, buildClientAttestationPop } from '@/lib/services/WIA';
import { buildDPoPProof } from '@/lib/utils/dpop';
import { useHttpClient } from './useHttpClient';
import { useWscdManagerClient } from './useWscdManagerClient';
import { IWscdManagerClient } from '@/lib/wscd-manager';


import { ZeroKnowledgeRequest, createZkProofService } from '@/lib/zero-knowledge/NativeBridgeZkDeviceResponse';
import type { ZkDcqlQuery } from '@/lib/zero-knowledge/types';

import { calculateJwkThumbprint } from 'jose';
import { cborEncode } from '@auth0/mdl/lib/cbor';
import { IssuerSigned } from '@owf/mdoc';
import type { ZkSessionTranscriptInput } from '@/lib/zero-knowledge/types';
import {
	buildOid4vpDcApiSessionTranscript,
	buildOid4vpSessionTranscript,
	decodeStoredMdoc,
	extractIssuerSignedB64,
	resolveMdocIssuerSigned,
} from '@/lib/verifiable-credentials';

let pendingDcqlQuery: unknown = undefined;

export function setPendingDcqlQuery(query: unknown) {
	pendingDcqlQuery = query;
}

function restoreZkFormat(query: any) {
	if (!Array.isArray(query?.credentials)) return query;
	return {
		...query,
		credentials: query.credentials.map((c: any) => {
			const systems = c?.meta?.zk_system_type;
			if (!Array.isArray(systems) || systems.length === 0) return c;
			let claims = Array.isArray(c.claims) ? c.claims : [];
			const fixedSystems = systems.map((s: any) => {
				if (s?.system !== 'longfellow-libzk-v1') return s;
				const n = Number(s.num_attributes ?? claims.length);
				const hasPseudonym = claims.some((cl: any) => cl?.path?.[cl.path.length - 1] === 'pairwise_pseudonym');
				if (!hasPseudonym && n === claims.length + 1) {
					claims = [...claims, { path: [claims[0]?.path?.[0] ?? 'org.iso.18013.5.1', 'pairwise_pseudonym'] }];
				}
				return { ...s, num_attributes: n };
			});
			return { ...c, format: 'mso_mdoc_zk', claims, meta: { ...c.meta, zk_system_type: fixedSystems } };
		}),
	};
}

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
	dcqlQuery?: unknown;
	htm?: string;
	htu?: string;
	dpopNonce?: string;
	ath?: string;
	keyId?: string;
	attestationChallenge?: string;
}

export interface OIDFlowSignRequest {
	flowId: string;
	action: 'generate_proof' | 'sign_presentation' | 'sign_client_auth';
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
	dpopKeyId?: string;
	dpopProof?: string;
}

export function useOIDFlowSignHandler() {
	const {
		api,
		keystore,
		authTokens,
		oidFlowClientAuthMaterialManager,
	} = useContext(SessionContext);
	const httpClient = useHttpClient();
	const wscd = useWscdManagerClient();

	const signPresentation = useCallback(async (options: OIDFlowSignOptions): Promise<OIDFlowSignResponse> => {
		const { audience, nonce, credentialsToInclude, responseUri, origin, verifierJwkThumbprint, dcqlQuery } = options;
		const verifierQuery = restoreZkFormat(dcqlQuery ?? pendingDcqlQuery);
		if (!wscd) {
			throw new Error('WscdManagerClient is not initialized');
		}
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
				wscd,
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
					dcqlQuery: verifierQuery,
				}
			);

			vpTokenMap[c.credentialQueryId] = [vpToken];
		}

		logger.debug(`[WS Sign Handler] Signed VP token(s) for ${Object.keys(vpTokenMap).length} query/queries`);

		return {
			vpToken: JSON.stringify(vpTokenMap)
		};
	}, [wscd]);

	const generateProof = useCallback(async (options: OIDFlowSignOptions): Promise<OIDFlowSignResponse> => {
		const { audience, nonce, proofTypesSupported, issuer, count = 1 } = options;
		if (!wscd) {
			throw new Error('WscdManagerClient is not initialized');
		}
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
			const keypairs = await wscd.generateKeypairs(count);

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

			const proof_jwts = await wscd.generateOpenid4vciProofs(requests);

			const proofs: ProofObject[] = proof_jwts.map(jwt => ({
				proof_type: proofType,
				jwt,
			}));

			logger.debug(`[WS Sign Handler] Generated ${proofs.length} proof(s)`);
			return { proofs };
		}

		throw new Error(`Unsupported proof type requested: ${proofType}`);
	}, [wscd, api]);

	const signClientAuth = useCallback(async (
		options: OIDFlowSignOptions,
		flowId: string,
	): Promise<OIDFlowSignResponse> => {
		const { audience, issuer, htm, htu, dpopNonce, ath, attestationChallenge } = options;

		if (!wscd) {
			throw new Error('WscdManagerClient is not initialized');
		}

		const authMaterial = await oidFlowClientAuthMaterialManager.getAuthMaterial(
			flowId
		);

		const response: OIDFlowSignResponse = { dpopKeyId: authMaterial.dpopKeyId };

		if (htm && htu) {
			response.dpopProof = await buildDPoPProof(
				authMaterial.keyPair,
				{
					htm,
					htu,
					ath,
					nonce: dpopNonce
				},
			);
		}

		if (audience && issuer) {
			try {
				const wia = await attestFlowIfEnabled(
					httpClient,
					(await authTokens.ensureBackendToken()).raw,
					WIA_ENABLED,
					authMaterial.wia,
					authMaterial.keyPair,
					issuer,
					BACKEND_URL,
				);

				if (wia) {
					oidFlowClientAuthMaterialManager.attachWia(flowId, wia);
					response.clientAttestation = wia;
					response.clientAttestationPoP = await buildClientAttestationPop(
						authMaterial.keyPair,
						issuer,
						audience,
						attestationChallenge,
					);
				}
			}
			catch (err) {
				logger.debug(
					'[WS Sign Handler] WIA attach failed; proceeding DPoP-only',
					err,
				);
			}
		}

		return response;
	}, [oidFlowClientAuthMaterialManager, httpClient, authTokens, wscd]);

	const handleSignRequest = useCallback(async (request: OIDFlowSignRequest): Promise<OIDFlowSignResponse> => {
		logger.debug('[WS Sign Handler] Received sign request:', request.action);

		if (!keystore) throw new Error('Keystore not available');

		switch (request.action) {
			case 'sign_client_auth':
				return await signClientAuth(request.params, request.flowId);
			case 'generate_proof':
				return await generateProof(request.params);
			case 'sign_presentation':
				return await signPresentation(request.params);
			default:
				throw new Error(`Unknown sign action: ${request.action}`);
		}
	}, [keystore, generateProof, signPresentation, signClientAuth]);

	return { handleSignRequest, signPresentation, generateProof };
}

async function createVpToken(
	wscd: IWscdManagerClient,
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
		dcqlQuery?: unknown;
	}
) {
	const { credentialRaw, disclosedClaims } = credentialData;
	const { nonce, audience, responseUri, origin, verifierJwkThumbprint, dcqlQuery } = params;


	switch (detectCredentialFormat(credentialRaw)) {
			case VerifiableCredentialFormat.DC_SDJWT:
			case VerifiableCredentialFormat.VC_SDJWT:
			case VerifiableCredentialFormat.JWT_VC_JSON:
				return await createVpTokenFromSdJwt(
					wscd,
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
					wscd,
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
						dcqlQuery,
					}
				);
			// `vc+sd-jwt` is VC-JOSE-COSE's media type for a VCDM 2.0 credential
			// secured as an SD-JWT — not for an IETF SD-JWT VC, which is
			// `dc+sd-jwt`. A verifier asking for `vc+sd-jwt` is therefore
			// asking for a VCDM 2.0 credential and expects it inside a VCDM 2.0
			// VerifiablePresentation, not a bare SD-JWT with a key-binding JWT.
			// Nothing is lost by not using KB-JWT here: DIIP v5 discloses every
			// claim, so there are no disclosures to withhold, and holder
			// binding comes from the holder-signed presentation envelope.
			case VerifiableCredentialFormat.VCDM2_SDJWT:
			case VerifiableCredentialFormat.VCDM2_JOSE:
			case VerifiableCredentialFormat.LDP_VC:
				return await createVpTokenFromVcdm2(
					wscd,
					{ credentialRaw },
					{ nonce, audience }
				);
			default:
				throw new Error('Unsupported credential format for presentation signing');
		}
}

async function createVpTokenFromSdJwt(
	wscd: IWscdManagerClient,
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
	const vpjwt = await wscd.signSdJwtPresentation({
		audience,
		nonce,
		verifiableCredential: credential,
	});
	return vpjwt;
}

/**
 * Present a W3C VCDM 2.0 credential.
 *
 * There is no selective disclosure here: neither an enveloped credential nor a
 * plain Data Integrity proof supports it, so the whole credential is
 * presented. (`ecdsa-sd-2023` is the format's selective-disclosure mechanism,
 * and is not supported.) Any `disclosedClaims` the caller passes are therefore
 * deliberately ignored rather than silently appearing to filter anything.
 */
async function createVpTokenFromVcdm2(
	wscd: IWscdManagerClient,
	credentialData: {
		credentialRaw: string;
	},
	params: {
		nonce: string;
		audience: string;
	}
): Promise<string> {
	const { credentialRaw } = credentialData;
	const { nonce, audience } = params;

	// A Data Integrity credential is stored as JSON text but must be
	// presented as an object, so that it embeds in the presentation rather
	// than being double-encoded as a string.
	const credential = detectCredentialFormat(credentialRaw) === VerifiableCredentialFormat.LDP_VC
		? JSON.parse(credentialRaw)
		: credentialRaw;

	const vpjwt = await wscd.signVcdm2Presentation({
		nonce,
		audience,
		verifiableCredentials: [credential],
	});

	return vpjwt;
}

async function createVpTokenFromMdoc(
	wscd: IWscdManagerClient,
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
		dcqlQuery?: unknown;
	}
): Promise<string> {
	const { credentialRaw, disclosedClaims } = credentialData;
	const { nonce, audience, responseUri, origin, verifierJwkThumbprint, dcqlQuery } = params;

	if (!responseUri && !origin) {
		throw new Error('Missing responseUri or origin for mdoc presentation');
	}

	if (responseUri && origin) {
		throw new Error('Both responseUri and origin provided for mdoc presentation, only one should be provided');
	}

	if (!disclosedClaims?.length) {
		throw new Error('disclosedClaims required for mdoc presentation');
	}
	console.log("here check!")
	console.log(dcqlQuery)
	if (JSON.stringify(dcqlQuery ?? {}).includes('mso_mdoc_zk')) {
		console.log("inside check")
		return createZkVpTokenFromMdoc(credentialRaw, dcqlQuery as ZkDcqlQuery, {
			nonce, audience, responseUri, origin, verifierJwkThumbprint,
		}, /* sign: the WSCD's (kid, toBeSigned) signer */);
	}
	console.log("after check!")

	let deviceResponseMDoc: Uint8Array;
	if (responseUri) {
		deviceResponseMDoc = await wscd.generateDeviceResponse({
			credential: credentialRaw,
			disclosedClaims,
			sessionTranscript: {
				clientId: audience,
				responseUri,
				nonce,
				jwkThumbprint: verifierJwkThumbprint ?? undefined,
			},
		});

	} else if (origin) {
		deviceResponseMDoc = await wscd.generateDeviceResponseForDCAPI({
			credential: credentialRaw,
			disclosedClaims,
			sessionTranscript: {
				origin,
				nonce,
				jwkThumbprint: verifierJwkThumbprint ?? undefined,
			},
		});
	} else {
		throw new Error('Unexpected error: neither responseUri nor origin provided for mdoc presentation');
	}

	return base64url.encode(new Uint8Array(deviceResponseMDoc instanceof Uint8Array ? deviceResponseMDoc : deviceResponseMDoc.encode()));
}


type DeviceKeySigner = (kid: string, toBeSigned: Uint8Array) => Promise<Uint8Array>;

async function createZkVpTokenFromMdoc(
	credentialRaw: string,
	dcqlQuery: ZkDcqlQuery,
	params: {
		nonce: string;
		audience: string;
		responseUri?: string;
		origin?: string;
		verifierJwkThumbprint?: string;
	},
	sign?: DeviceKeySigner,
): Promise<string> {
	const { nonce, audience, responseUri, origin, verifierJwkThumbprint } = params;

	const sessionTranscript = responseUri
		? await buildOid4vpSessionTranscript({ clientId: audience, responseUri, nonce, jwkThumbprint: verifierJwkThumbprint ?? null })
		: await buildOid4vpDcApiSessionTranscript({ origin: origin!, nonce, jwkThumbprint: verifierJwkThumbprint ?? null });

	const request = new ZeroKnowledgeRequest(
		dcqlQuery,
		{ kind: 'raw', sessionTranscript: base64url.encode(sessionTranscript.encode()) } as unknown as ZkSessionTranscriptInput,
		responseUri ? audience : origin!,
	);

	const kid = await deviceKeyKid(credentialRaw);
	const signer = sign
		? async (data: Uint8Array) => {
			const signature = await sign(kid, data);
			if (signature.length !== 64) throw new Error(`device signature must be raw 64-byte r||s, got ${signature.length} bytes`);
			return signature;
		}
		: undefined;

	const emit = (type: string, detail: unknown) => window.dispatchEvent(new CustomEvent(type, { detail }));

	const result = await createZkProofService().generateProof(
		{ rawMdocB64u: storedMdocEnvelopeB64u(credentialRaw) },
		request,
		{ signer, onProgress: (step) => emit('zkp:step', { step }) },
	);
	emit('zkp:complete', { system: result.system, queryId: result.queryId, disclosedClaims: result.disclosedClaims, size: result.deviceResponse.byteLength });

	return base64url.encode(result.deviceResponse);
}

function storedMdocEnvelopeB64u(credentialRaw: string): string {
	const decoded = decodeStoredMdoc(credentialRaw);
	if (Array.isArray(decoded.get('documents'))) return credentialRaw;

	const { docType } = resolveMdocIssuerSigned(decoded);
	return base64url.encode(cborEncode(new Map<string, unknown>([
		['version', '1.0'],
		['documents', [new Map<string, unknown>([['docType', docType], ['issuerSigned', decoded]])]],
		['status', 0],
	])));
}

async function deviceKeyKid(credentialRaw: string): Promise<string> {
	const issuerSigned = IssuerSigned.fromEncodedForOid4Vci(extractIssuerSignedB64(credentialRaw));
	return calculateJwkThumbprint(issuerSigned.issuerAuth.mobileSecurityObject.deviceKeyInfo.deviceKey.jwk, 'sha256');
}