import { JWK, KeyLike, SignJWT } from 'jose';
import { generateRandomIdentifier } from '../utils/generateRandomIdentifier';
import { logger } from '@/logger';
import { IHttpClient } from '../interfaces/IHttpClient';

export interface WIAKeyPair {
	privateKey: KeyLike | Uint8Array;
	publicKeyJwk: JWK;
}

/**
 * Request a Wallet Instance Attestation (WIA) from the wallet provider backend,
 * bound to the provided DPoP key pair.
 *
 * The WIA is:
 * - Reused across the flow's requests, but each WIA is used at most once per issuance.
 * - Never persisted or reused across different flows.
 * - Bound to the provided DPoP key pair.
 * - `cnf` key MUST equal the flow's DPoP key (EC TS03 §2.2.1.1)
 *
 * If the backend doesn't support WIA or the request fails, the function
 * returns `undefined`, so that the request can carry on without a WIA, since
 * Tier 3 WIA is informative and must never block the request.
 */
export async function requestWIA(
	httpClient: IHttpClient,
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	walletProviderURI: string,
): Promise<string | undefined> {
	try {
		const challengeResponse = await httpClient.post('/wallet-provider/wia/challenge', {});
		if (
			!challengeResponse?.data ||
			typeof challengeResponse.data !== 'object' ||
			!('challenge' in challengeResponse.data) ||
			!challengeResponse.data.challenge ||
			typeof challengeResponse.data.challenge !== 'string'
		) {
			logger.debug('Cannot parse challenge from wallet-backend-server WIA challenge response');
			return undefined;
		}

		const { challenge } = challengeResponse.data;

		const pop = await new SignJWT({ nonce: challenge })
			.setProtectedHeader({
				alg: 'ES256',
				typ: 'oauth-client-attestation-pop+jwt',
				jwk: dpopKeyPair.publicKeyJwk,
			})
			.setIssuer(clientId)
			// aud is our wallet-provider backend (issues the WIA), not the issuer's
			// AS like buildClientAttestationPop below.
			.setAudience(walletProviderURI)
			.setIssuedAt()
			.setExpirationTime('5m')
			.setJti(generateRandomIdentifier(8))
			.sign(dpopKeyPair.privateKey);

		const generateResponse = await httpClient.post('/wallet-provider/wia/generate', {
			pop,
			challenge,
			client_id: clientId,
		});
		if (
			!generateResponse?.data ||
			typeof generateResponse.data !== 'object' ||
			!('wallet_instance_attestation' in generateResponse.data) ||
			!generateResponse.data.wallet_instance_attestation ||
			typeof generateResponse.data.wallet_instance_attestation !== 'string'
		) {
			logger.debug(
				'Cannot parse wallet_instance_attestation from wallet-backend-server WIA generate response'
			);
			return undefined;
		}
		const wia = generateResponse.data.wallet_instance_attestation;
		return wia;
	}
	catch (err) {
		logger.debug(err);
		return undefined;
	}
}

/**
 * Build a fresh OAuth-Client-Attestation-PoP JWT for a single PAR/token
 * request to the credential issuer's authorization server.
 *
 * This is a DIFFERENT PoP than the one requestWIA sends to our own backend
 * above — different audience (the issuer's authorization server, not our
 * wallet provider), and no `jwk` header, since the issuer verifies it
 * against the public key already carried in the accompanying WIA's `cnf`
 * claim rather than a self-contained key. Must be freshly generated for
 * every request (anti-replay) — never reuse a PoP JWT across requests, even
 * to the same issuer.
 */
export async function buildClientAttestationPop(
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	authorizationServerIssuer: string,
): Promise<string> {
	return await new SignJWT({})
		.setProtectedHeader({
			alg: 'ES256',
			typ: 'oauth-client-attestation-pop+jwt',
		})
		.setIssuer(clientId)
		.setAudience(authorizationServerIssuer)
		.setIssuedAt()
		.setExpirationTime('5m')
		.setJti(generateRandomIdentifier(8))
		.sign(dpopKeyPair.privateKey);
}

/**
 * Decide whether to (re-)request a WIA for the current OID4VCI flow, and do
 * so if needed. Pulled out of the OpenID4VCI flow orchestration so the
 * enabled/reuse decision is independently testable, rather than only
 * reachable by exercising the whole React hook.
 *
 * Reuses existingWia rather than requesting a fresh one — each flow's WIA
 * is requested at most once, matching the single-use-per-issuance design
 * (see requestWIA's docs above); a retry within the same flow (e.g. on a
 * DPoP nonce challenge) must not mint a second WIA for the same flow.
 */
export async function attestFlowIfEnabled(
	httpClient: IHttpClient,
	enabled: boolean,
	existingWia: string | undefined,
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	walletProviderURI: string,
): Promise<string | undefined> {
	if (!enabled) {
		return undefined;
	}
	if (existingWia) {
		return existingWia;
	}
	return await requestWIA(httpClient, dpopKeyPair, clientId, walletProviderURI);
}
